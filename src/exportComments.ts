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
  .option("prs", {
    alias: "p",
    type: "string",
    description: "Comma-separated list of pull request numbers",
    demandOption: true,
  })
  .option("author", {
    alias: "a",
    type: "string",
    description: "Author of the comments to filter with",
    demandOption: false,
  })
  .parseSync(); // Use parseSync to ensure argv is not a Promise

interface Comment {
  author: string;
  prNumber: string;
  category: string[];
  comment: string;
  commentLink: string;
}

const csvWriter = createObjectCsvWriter({
  path: "pr_comments.csv",
  header: [
    { id: "author", title: "Author" },
    { id: "prNumber", title: "PR Number" },
    { id: "category", title: "Category" },
    { id: "comment", title: "Comment" },
    { id: "commentLink", title: "Comment Link" },
  ],
});

const reactionToCategory: { [key: string]: string } = {
  "+1": "Useful",
  eyes: "Noisy",
  confused: "Hallucination",
  rocket: "Teachable",
  "-1": "Incorrect",
};

function extractCategories(reactions: any): string[] {
  return Object.keys(reactions)
    .filter(
      (reaction) => reactionToCategory[reaction] && reactions[reaction] > 0
    )
    .map((reaction) => reactionToCategory[reaction]);
}

async function fetchComments(): Promise<void> {
  const prNumbers = argv.prs
    .split(",")
    .map((pr: string) => parseInt(pr.trim(), 10));
  let allComments: Comment[] = [];

  for (const prNumber of prNumbers) {
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
      response.data.map(async (comment: any) => {
        const categories = extractCategories(comment.reactions);
        return {
          author: comment.user.login,
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

fetchComments();
