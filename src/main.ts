/**
 * This script is designed to be used in a GitHub Actions workflow to automatically review pull requests.
 * It fetches the details and diff of a pull request, analyzes the code changes using OpenAI's API, and
 * posts review comments on the pull request based on the analysis.
 *
 * The script performs the following steps:
 * 1. Fetches the pull request details and diff.
 * 2. Filters the diff based on include and exclude patterns.
 * 3. Analyzes the code changes using OpenAI's API to generate review comments.
 * 4. Posts the generated review comments on the pull request.
 *
 * Environment Variables:
 * - GITHUB_TOKEN: GitHub personal access token (required)
 * - OPENAI_API_KEY: OpenAI API key (required)
 * - OPENAI_API_MODEL: OpenAI API model to use (required)
 * - OPENAI_API_VERSION: OpenAI API version to use (required)
 * - OPENAI_BASE_URL: Base URL for the OpenAI API (optional)
 * - DEBUG_HTTP: Enable HTTP request debugging (optional)
 *
 * Example Usage:
 *   npx ts-node main.ts
 *
 * Note: It is recommended to set the GITHUB_TOKEN and OPENAI_API_KEY environment variables to avoid exposing sensitive information.
 */

import { readFileSync } from "fs";
import * as core from "@actions/core";
import OpenAI from "openai";
import { Octokit } from "@octokit/rest";
import parseDiff, { Chunk, File } from "parse-diff";
import minimatch from "minimatch";

const GITHUB_TOKEN: string = core.getInput("GITHUB_TOKEN");
const OPENAI_API_KEY: string = core.getInput("OPENAI_API_KEY");
const OPENAI_API_MODEL: string = core.getInput("OPENAI_API_MODEL");
const OPENAI_API_VERSION: string = core.getInput("OPENAI_API_VERSION");
const OPENAI_BASE_URL: string = core.getInput("OPENAI_BASE_URL"); // Keep the default value as undefined instead of empty strings.

// Supports HTTP requests debugging via an environment variable.
const debugHttp: string | undefined = process.env.DEBUG_HTTP;
if (debugHttp) {
  // Intercept all HTTP requests
  const nock = require("nock");
  nock.recorder.rec({
    output_objects: true,
    logging: (content: any) => {
      console.log("HTTP Request:", content);
    },
  });
  console.log("HTTP calls interception enabled");
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL,
  defaultQuery: { "api-version": OPENAI_API_VERSION },
  defaultHeaders: { "api-key": OPENAI_API_KEY },
});

// The supported Github events that this Github action can handle.
type GitHubEvent = "opened" | "synchronize" | "push";

// Data structure to host the details of a pull request.
interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

/**
 * Retrieves pull request details based on the GitHub event type.
 *
 * This function reads the GitHub event data from the environment, logs it for debugging purposes,
 * and then determines the appropriate method to fetch pull request details based on the event type.
 * It supports the "opened", "synchronize", and "push" events.
 *
 * @param {GitHubEvent} event - The type of GitHub event ("opened", "synchronize", or "push").
 * @returns {Promise<PRDetails>} - A promise that resolves to the pull request details.
 *
 * @throws {Error} - Throws an error if the event type is unsupported.
 */
async function getPrDetails(
  eventName: GitHubEvent,
  eventData: any
): Promise<PRDetails> {
  const eventPath = process.env.GITHUB_EVENT_PATH || "";

  console.log("process.env.GITHUB_EVENT_NAME", process.env.GITHUB_EVENT_NAME)
  console.log("eventName", eventName)
  console.log("eventName", eventName)
  if (process.env.GITHUB_EVENT_NAME === "pull_request") {
    eventName = eventData.action; // Use action, not "pull_request"
  }

  switch (eventName) {
    case "opened":
    case "synchronize":
      return getPrFromEvent(eventData);
    case "push":
      return getPrFromApi(eventData);
    default:
      throw new Error(`Unsupported event: eventName=${eventName}, actionType=${eventData.action}`);
  }
}


/**
 * Retrieves pull request details from the given event data.
 *
 * @param eventData - The event data containing repository and pull request number.
 * @returns A promise that resolves to the pull request details.
 * @throws Will throw an error if the event payload is missing the repository or number.
 */
async function getPrFromEvent(eventData: any): Promise<PRDetails> {
  const { repository, number } = eventData;
  if (!repository || !number) {
    throw new Error("Invalid event payload: missing repository or number");
  }

  const prResponse = await octokit.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });
  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
}

/**
 * Retrieves the pull request details associated with a given push event from the GitHub API.
 *
 * @param eventData - The event data containing information about the push event.
 * @returns A promise that resolves to the details of the associated pull request.
 * @throws Will throw an error if no associated pull request is found for the given push event.
 */
async function getPrFromApi(eventData: any): Promise<PRDetails> {
  const branchName = eventData.ref.replace("refs/heads/", "");
  const repoOwner = eventData.repository.owner.login;
  const repoName = eventData.repository.name;

  const { data: pullRequests } = await octokit.pulls.list({
    owner: repoOwner,
    repo: repoName,
    state: "open",
  });

  const pullRequest = pullRequests.find((pr) => pr.head.ref === branchName);

  if (!pullRequest) {
    throw new Error("No associated pull request found for this push event.");
  }

  return {
    owner: repoOwner,
    repo: repoName,
    pull_number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.body ?? "",
  };
}

/**
 * Fetches the diff of a pull request from the GitHub repository.
 *
 * This function uses the GitHub API to retrieve the diff of a specified pull request.
 * The diff is returned as a string, or null if the request fails.
 *
 * @param {string} owner - The owner of the repository.
 * @param {string} repo - The name of the repository.
 * @param {number} pull_number - The number of the pull request.
 * @returns {Promise<string | null>} - A promise that resolves to the diff string or null if the request fails.
 */
async function getDiff(
  owner: string,
  repo: string,
  pull_number: number
): Promise<string | null> {
  const response = await octokit.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // @ts-expect-error - response.data is a string
  return response.data;
}

/**
 * Analyzes the parsed diff files and generates review comments using AI.
 *
 * This function iterates over the parsed diff files and their respective chunks,
 * identifies valid line numbers for changes, and generates a prompt for the AI to review the code.
 * It then filters the AI responses to ensure they correspond to valid line numbers and creates
 * review comments based on the AI responses.
 *
 * @param {File[]} parsedDiff - An array of parsed diff files to be analyzed.
 * @param {PRDetails} prDetails - Details of the pull request, including owner, repo, pull number, title, and description.
 * @returns {Promise<Array<{ body: string; path: string; line: number }>>} - A promise that resolves to an array of review comments.
 */
async function analyzeCode(
  parsedDiff: File[],
  prDetails: PRDetails
): Promise<Array<{ body: string; path: string; line: number }>> {
  const comments: Array<{ body: string; path: string; line: number }> = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") continue; // Ignore deleted files
    for (const chunk of file.chunks) {
      const validLineNumbers = new Set<number>();
      chunk.changes.forEach((change: parseDiff.Change) => {
        if ("ln" in change && change.ln) validLineNumbers.add(change.ln);
        if ("ln2" in change && change.ln2) validLineNumbers.add(change.ln2);

        // Generate a range of line numbers for additive changes.
        if ("ln1" in change && "ln2" in change && change.ln1 && change.ln2) {
          for (let i = change.ln1; i <= change.ln2; i++) {
            validLineNumbers.add(i);
          }
        }
      });

      const prompt = createPrompt(file, chunk, prDetails);
      const aiResponse = await getAIResponse(prompt);
      if (aiResponse) {
        const validAIResponses = aiResponse.filter((response) =>
          validLineNumbers.has(Number(response.lineNumber))
        );
        // Leave a log for each invalid line numbers for further debugging.
        aiResponse.forEach((response) => {
          if (!validLineNumbers.has(Number(response.lineNumber))) {
            console.log(
              `Invalid line number: ${response.lineNumber} in file: ${file.to}\nComment: ${response.reviewComment}`
            );
          }
        });
        const newComments = createComment(file, chunk, validAIResponses);
        if (newComments) {
          comments.push(...newComments);
        }
      }
    }
  }
  return comments;
}

/**
 * Generates a prompt string for reviewing pull requests based on the provided file, chunk, and PR details.
 *
 * @param {File} file - The file object containing information about the file being reviewed.
 * @param {Chunk} chunk - The chunk object containing the diff content and changes.
 * @param {PRDetails} prDetails - The pull request details including title and description.
 * @returns {string} The generated prompt string for the review task.
 */
function createPrompt(file: File, chunk: Chunk, prDetails: PRDetails): string {
  return `Your task is to review pull requests. Instructions:
- Provide the response in following JSON format:  {"reviews": [{"lineNumber":  <line_number>, "reviewComment": "<review comment>"}]}
- Do not give positive comments or compliments.
- Provide comments and suggestions ONLY if there is something to improve, otherwise "reviews" should be an empty array.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
- IMPORTANT: NEVER suggest adding comments to the code.

Review the following code diff in the file "${
    file.to
  }" and take the pull request title and description into account when writing the response.
  
Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

Git diff to review:

\`\`\`diff
${chunk.content}
${chunk.changes
  // @ts-expect-error - ln and ln2 exists where needed
  .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
  .join("\n")}
\`\`\`
`;
}

/**
 * Fetches AI-generated review comments for a given prompt.
 *
 * @param prompt - The input string to be sent to the AI model for generating responses.
 * @returns A promise that resolves to an array of review comments, each containing a line number and a review comment, or null if an error occurs.
 *
 * The function configures the query parameters for the AI model, sends the prompt to the model, and parses the response.
 * If the model supports JSON responses, it requests the response in JSON format.
 * In case of an error during the API call, it logs the error and returns null.
 */
async function getAIResponse(prompt: string): Promise<Array<{
  lineNumber: string;
  reviewComment: string;
}> | null> {
  const queryConfig = {
    model: OPENAI_API_MODEL,
    temperature: 0.2,
    max_tokens: 700,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
  };

  try {
    const response = await openai.chat.completions.create({
      ...queryConfig,
      // return JSON if the model supports it:
      ...(OPENAI_API_MODEL === "gpt-4-1106-preview" ||
      OPENAI_API_MODEL === "gpt-4o"
        ? { response_format: { type: "json_object" } }
        : {}),
      messages: [
        {
          role: "system",
          content: prompt,
        },
      ],
    });

    const res = response.choices[0].message?.content?.trim() || "{}";
    return JSON.parse(res).reviews;
  } catch (error) {
    console.error("Could not fetch AI response:", error);
    return null;
  }
}

/**
 * Generates an array of review comments for a given file and chunk based on AI responses.
 *
 * @param file - The file object containing information about the file being reviewed.
 * @param chunk - The chunk object representing a portion of the file.
 * @param aiResponses - An array of AI response objects, each containing a line number and a review comment.
 * @returns An array of objects, each representing a review comment with a body, path, and line number.
 */
function createComment(
  file: File,
  chunk: Chunk,
  aiResponses: Array<{
    lineNumber: string;
    reviewComment: string;
  }>
): Array<{ body: string; path: string; line: number }> {
  return aiResponses.flatMap((aiResponse) => {
    if (!file.to) {
      return [];
    }
    return {
      body: aiResponse.reviewComment,
      path: file.to,
      line: Number(aiResponse.lineNumber),
    };
  });
}

/**
 * Creates a review comment on a pull request.
 *
 * @param owner - The owner of the repository.
 * @param repo - The name of the repository.
 * @param pull_number - The number of the pull request.
 * @param comments - An array of comment objects, each containing:
 *   - `body`: The text of the comment.
 *   - `path`: The file path to which the comment applies.
 *   - `line`: The line number in the file where the comment should be placed.
 * @returns A promise that resolves when the review comment has been created.
 */
async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<{ body: string; path: string; line: number }>
): Promise<void> {
  const validComments = comments.filter((comment) => comment.line > 0);
  if (validComments.length === 0) {
    console.log("No valid comments to post.");
    return;
  }

  await octokit.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments: validComments,
    event: "COMMENT",
  });
}

/**
 * Filters the parsed diff files based on include and exclude patterns.
 *
 * This function reads the `exclude` and `include` patterns from the GitHub Action inputs,
 * trims and filters out any empty strings, and then applies these patterns to the parsed diff files.
 * Files that match the exclude patterns are excluded, and files that match the include patterns are included.
 * If both patterns are provided, the exclude patterns take precedence over the include patterns.
 *
 * @param {File[]} parsedDiff - An array of parsed diff files to be filtered.
 * @returns {File[]} - An array of filtered diff files.
 */
function filterDiffs(parsedDiff: File[]): File[] {
  const excludePatterns = core
    .getInput("exclude")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0); // Filter out empty strings;

  const includePatterns = core
    .getInput("include")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0); // Filter out empty strings;

  const filteredDiff = parsedDiff.filter((file) => {
    const excluded: boolean =
      excludePatterns.length > 0 &&
      excludePatterns.some((pattern) => minimatch(file.to ?? "", pattern));

    const included: boolean =
      includePatterns.length === 0 ||
      includePatterns.some((pattern) => minimatch(file.to ?? "", pattern));

    // Excluded patterns take precedence over included patterns.
    return !excluded && included;
  });

  return filteredDiff;
}

async function main() {
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  const eventName = process.env.GITHUB_EVENT_NAME === "pull_request"
    ? eventData.action // Use action from eventData
    : (process.env.GITHUB_EVENT_NAME as GitHubEvent);

  const prDetails = await getPrDetails(eventName, eventData);
  if (!prDetails) {
    console.log("No associated pull request found for this push event.");
    return;
  }

  let diff: string | null;
  switch (eventName) {
    case "opened":
    case "push":
      diff = await getDiff(
        prDetails.owner,
        prDetails.repo,
        prDetails.pull_number
      );
      break;
    case "synchronize":
      const newBaseSha = eventData.before;
      const newHeadSha = eventData.after;

      const response = await octokit.repos.compareCommits({
        headers: {
          accept: "application/vnd.github.v3.diff",
        },
        owner: prDetails.owner,
        repo: prDetails.repo,
        base: newBaseSha,
        head: newHeadSha,
      });
      diff = String(response.data);
      break;
    default:
      console.log(
        `Unsupported event: eventName=${eventName}, process.env.GITHUB_EVENT_NAME=${process.env.GITHUB_EVENT_NAME}`
      );
      return;
  }
  if (!diff) {
    console.log("No diff found");
    return;
  }

  const parsedDiff = parseDiff(diff);
  const filteredDiff = filterDiffs(parsedDiff);

  console.log("parsedDiff", parsedDiff)
  console.log("filteredDiff", filteredDiff)

  const comments = await analyzeCode(filteredDiff, prDetails);
  if (comments.length > 0) {
    // We want to log the comments to be posted for debugging purposes, as
    // we see errors when used in the actual workflow but cannot figure out
    // why without seeing these logged comments.
    comments.forEach((comment) => {
      console.log(
        `Comment to be posted: ${comment.body} at ${comment.path}:${comment.line}`
      );
    });

    await createReviewComment(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number,
      comments
    );
  }
  else
  {
    console.log("No comments");
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
