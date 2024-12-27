/**
 * This script fetches comments from specified GitHub pull requests and exports them to a CSV file.
 * It uses the GitHub API to retrieve the comments and filters them based on the provided author (if specified).
 * The resulting CSV file contains the pull request number, author, comment, and a link to the comment.
 *
 * Usage:
 *   npx ts-node exportComments.ts --token <your_github_token> --owner <repo_owner> --repo <repo_name> --prs <pr_numbers> [--author <author_name>]
 *
 * Options:
 *   --token, -t   GitHub personal access token (can also be set via the GITHUB_TOKEN environment variable)
 *                 It is recommended to use the environment variable to avoid exposing sensitive information.
 *   --owner, -o   Repository owner
 *   --repo, -r    Repository name
 *   --prs, -p     Comma-separated list of pull request numbers
 *   --author, -a  Author of the comments to filter with (optional)
 *
 * Example:
 *   npx ts-node exportComments.ts --owner cds-snc --repo cds-ai-codereviewer --prs 6,7,8 --author github-actions[bot]
 *
 * Environment Variable:
 *   GITHUB_TOKEN   GitHub personal access token (recommended to use this instead of --token argument)
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
  .option("repo", {
    alias: "r",
    type: "string",
    description: "Repository name",
    demandOption: true,
  })
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

async function fetchCommentsForPRs(prNumbers: string): Promise<void> {
  const intPrNumbers = prNumbers
    .split(",")
    .map((pr: string) => parseInt(pr.trim(), 10));
  let allComments: Comment[] = [];

  for (const prNumber of intPrNumbers) {
    const comments = await fetchCommentsForPR(prNumber);
    allComments = allComments.concat(comments);
  }

  await csvWriter.writeRecords(allComments);
  console.log("CSV file written successfully");
}

async function fetchCommentsForPR(prNumber: number): Promise<Comment[]> {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${argv.owner}/${argv.repo}/pulls/${prNumber}/comments`,
      {
        headers: {
          Authorization: `token ${argv.token}`,
        },
      }
    );

    let comments: Comment[] = await Promise.all(
      response.data.map(async (comment: Record<string, any>) => {
        const categories = extractCategories(comment.reactions);
        console.debug(`Categories for comment ${argv.repo}/pull/${prNumber}/${comment.id}:`, categories);
        return {
          date: comment.created_at,
          author: comment.user.login,
          repository: `${argv.owner}/${argv.repo}`,
          prNumber: prNumber.toString(),
          category: categories,
          comment: comment.body,
          commentLink: comment.html_url,
        };
      })
    );

    if (argv.author) {
      comments = comments.filter((comment) => comment.author === argv.author);
    }

    return comments;
  } catch (error) {
    console.error(`Error fetching comments for PR #${prNumber}:`, error);
    return [];
  }
}

async function fetchComments(since: Date, until: Date = new Date()): Promise<Comment[]> {
  let comments: Comment[] = [];
  try {
    const pullRequests = await fetchPullRequests(argv.owner, argv.repo, since, until);

    for (const pr of pullRequests) {
      console.log(`Fetching comments for PR ${argv.repo}/pull/${pr.number}...`);
      const prComments = await fetchCommentsForPR(pr.number);
      comments = comments.concat(prComments);
    }
  }
  finally {
    console.debug(`comments=${comments}`);
    await csvWriter.writeRecords(comments);
    console.log("CSV file written successfully");
  }
  return comments;
}

async function fetchPullRequests(owner: string, repo: string, since: Date, until: Date) {
  const pullRequests = [];
  let page = 1;
  let hasMore = true;

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

  return pullRequests;
}

fetchComments(argv.since, argv.until);
