/**
 * This script fetches comments from specified GitHub pull requests and exports them to a CSV file.
 * 
 * It uses the GitHub API to retrieve the comments and filters them based on the provided author (if specified).
 * The resulting CSV file contains the date, AI feedback, pull request number, author, comment, and a link to
 * the comment.
 *
 * Usage:
 *   npx ts-node exportComments.ts --token <your_github_token> --owner <repo_owner> --repo <repo_name> --prs <pr_numbers> [--author <author_name>]
 *
 * Options:
 *   --owner, -o    Repository owner (required)
 *   --repos, -r    Repositories to search into (required)
 *   --author, -a   Author of the comments to filter with (optional -- likely the AI bot author name)
 *   --since, -s    Filter comments since the given date (YYYY-MM-DD) (required)
 *   --until, -u    Filter comments until the given date (YYYY-MM-DD) (optional, defaults to current date)
 *   --token, -t    GitHub personal access token (can also be set via the GITHUB_TOKEN environment variable or `.env` file)
 *                  It is recommended to use the environment variable to avoid exposing sensitive information.
 *
 * Examples:
 *   npx ts-node exportComments.ts --owner cds-snc --repos cds-ai-codereviewer --author 'github-actions[bot]' --since 2024-12-01
 * 
 *   npx ts-node src/exportComments.ts --owner cds-snc --repos notification-terraform notification-api --author 'github-actions[bot]' --since 2024-12-01  --until 2024-12-31
 *
 * Environment Variable:
 *   GITHUB_TOKEN   GitHub personal access token (recommended to use this instead of --token argument)
 * 
 * The GITHUB_TOKEN can be configured using a .env file at the root of the project:
 * 
 * Example .env file:
 * 
 * ```txt
 * GITHUB_TOKEN=your_actual_token_here
 * ```
 */

import axios from "axios";
import { createObjectCsvWriter } from "csv-writer";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// filepath: /workspace/src/exportComments.ts
import dotenv from 'dotenv';
dotenv.config();

const argv = yargs(hideBin(process.argv))
  .option("token", {
    alias: "t",
    type: "string",
    description: "GitHub personal access token",
    demandOption: true,
    default: process.env.GITHUB_TOKEN,
  })
  .option("owner", {
    alias: "o",
    type: "string",
    description: "Repository owner",
    demandOption: true,
  })
  .option("repos", {
    alias: "r",
    type: "array",
    description: "List of repository names",
    demandOption: true,
  })
  .array("repos")
  .string("repos")
  .option("author", {
    alias: "a",
    type: "string",
    description: "Author of the comments to filter with",
    demandOption: false,
  })
  .option("since", {
    alias: "s",
    type: "string",
    description: "Filter comments since the given date (YYYY-MM-DD)",
    demandOption: true,
    coerce: coerceDate,
  })
  .option("until", {
    alias: "u",
    type: "string",
    description: "Filter comments until the given date (YYYY-MM-DD)",
    demandOption: false,
    coerce: coerceDate,
    default: new Date(),
  })
  .parseSync(); // Use parseSync to ensure argv is not a Promise

interface Comment {
  date: string;
  author: string;
  repository: string;
  prNumber: string;
  category: string[];
  comment: string;
  commentLink: string;
}

const csvWriter = createObjectCsvWriter({
  path: "pr_comments.csv",
  header: [
    { id: "date", title: "Date" },
    { id: "author", title: "Author" },
    { id: "repository", title: "Repository" },
    { id: "prNumber", title: "PR Number" },
    { id: "category", title: "Category" },
    { id: "comment", title: "Comment" },
    { id: "commentLink", title: "Comment Link" },
  ],
});

function coerceDate(dateStr: string): Date {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error("Invalid date format. Please use YYYY-MM-DD.");
  }
  return date;
}

const reactionToCategory: Record<string, string> = {
  "+1": "Useful",
  eyes: "Noisy",
  confused: "Hallucination",
  rocket: "Teachable",
  "-1": "Incorrect",
  null: "None",
};

function extractCategories(reactions: Record<string, any>): string[] {
  const category = Object.keys(reactions)
    .filter(
      (reaction) => reactionToCategory[reaction] && reactions[reaction] > 0
    )
    .map((reaction) => reactionToCategory[reaction]);
  const nonEmptyCategory = category?.length === 0 ? ["None"] : category;
  return nonEmptyCategory;
}

async function fetchCommentsForPR(owner: string, repository: string, prNumber: number, author?: string): Promise<Comment[]> {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repository}/pulls/${prNumber}/comments`,
      {
        headers: {
          Authorization: `token ${argv.token}`,
        },
      }
    );

    let comments: Comment[] = await Promise.all(
      response.data.map(async (comment: Record<string, any>) => {
        const categories = extractCategories(comment.reactions);
        console.debug(`Categories for comment ${repository}/pull/${prNumber}/${comment.id}:`, categories);
        return {
          date: comment.created_at,
          author: comment.user.login,
          repository: `${owner}/${repository}`,
          prNumber: prNumber.toString(),
          category: categories,
          comment: comment.body,
          commentLink: comment.html_url,
        };
      })
    );

    if (author) {
      comments = comments.filter((comment) => comment.author === author);
    }

    return comments;
  } catch (error) {
    console.error(`Error fetching comments for PR #${prNumber}:`, error);
    return [];
  }
}

// Function to fetch comments for multiple repositories
async function fetchCommentsForRepos(owner: string, repositories: string[], since: Date, until: Date, author?: string): Promise<Comment[]> {
  let allComments: Comment[] = [];
  for (const repository of repositories) {
    console.log(`Fetching comments for repository ${owner}/${repository}...`);
    const pullRequests = await fetchPullRequests(owner, repository, since, until);
    for (const pr of pullRequests) {
      const prComments = await fetchCommentsForPR(owner, repository, pr.number, author);
      allComments = allComments.concat(prComments);
    }
  }
  await csvWriter.writeRecords(allComments);
  console.log("CSV file written successfully");
  return allComments;
}

async function fetchPullRequests(owner: string, repo: string, since: Date, until: Date) {
  const pullRequests = [];
  let page = 1;
  let hasMore = true;

  console.debug(`Fetching pull requests for ${owner}/${repo}...`);
  while (hasMore) {
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
      headers: {
        Authorization: `token ${argv.token}`,
        Accept: 'application/vnd.github.v3+json',
      },
      params: {
        state: 'all',
        per_page: 100,
        page,
        sort: 'updated',
        direction: 'desc',
      },
    });

    const filteredPRs = response.data.filter((pr: any) => new Date(pr.updated_at) >= since && new Date(pr.updated_at) <= until);
    pullRequests.push(...filteredPRs);

    if (response.data.length < 100) {
      hasMore = false;
    } else {
      page++;
    }
  }

  console.debug(`Fetched ${pullRequests.length} pull requests for ${owner}/${repo}`);
  return pullRequests;
}

fetchCommentsForRepos(argv.owner, argv.repos, argv.since, argv.until, argv.author);
