# CDS AI Code Reviewer

CDS AI Code Reviewer is a GitHub Action that leverages OpenAI's GPT-4 API to provide intelligent feedback and suggestions on
your pull requests. This powerful tool helps improve code quality and saves developers time by automating the code
review process.

## Features

- Reviews pull requests using OpenAI's GPT-4 API.
- Provides intelligent comments and suggestions for improving your code.
- Filters out files that match specified exclude patterns.
- Easy to set up and integrate into your GitHub workflow.

## Setup

1. To use this GitHub Action, you need an OpenAI API key. If you don't have one, sign up for an API key
   at [OpenAI](https://beta.openai.com/signup) or via the Azure OpenAI API.

2. Add the OpenAI API key as a GitHub Secret in your repository with the name `OPENAI_API_KEY`. You can find more
   information about GitHub Secrets [here](https://docs.github.com/en/actions/reference/encrypted-secrets).

3. a. Create a `.github/workflows/main.yml` file in your repository and add the following content, if you want the AI review to trigger on every opened PR and corresponding updates:

```yaml
name: AI Code Reviewer

on:
  pull_request:
    types:
      - opened
      - synchronize
permissions: write-all
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v3

      - name: AI Code Reviewer
        uses: scopear/ai-codereviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # The GITHUB_TOKEN is there by default so you just need to keep it like it is and not necessarily need to add it as secret as it will throw an error. [More Details](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#about-the-github_token-secret)
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_API_MODEL: "gpt-4" # Optional: defaults to "gpt-4"
          OPENAI_API_VERSION: ${{ vars.OPENAI_API_VERSION }}
          OPENAI_BASE_URL: ${{ vars.OPENAI_BASE_URL }}
          exclude: "**/*.json, **/*.md" # Optional: exclude patterns separated by commas
          include: "**/*.ts" # Optional: include patterns separated by commas
```

3. b. For reduced cost with OpenAI, a different configuration is possible on the action. This will be a manual trigger on commits message that contains the `[review]` keyword. The action will process the entirety of the related pull request for which the commit was pushed for. Ideally, you want to use this trigger once when the pull request is ready. Copy the configuration below:

```yaml
name: Code Review with OpenAI
on:
  push:
    branches-ignore:
      - main

permissions: write-all
jobs:
  code_review:
    if: contains(github.event.head_commit.message, '[review]')
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repo
        uses: actions/checkout@v3

      - name: CDS AI Code Reviewer
        uses: cds-snc/cds-ai-code-reviewer@main
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }} # The GITHUB_TOKEN is there by default so you just need to keep it like it is and not necessarily need to add it as secret as it will throw an error. [More Details](https://docs.github.com/en/actions/security-guides/automatic-token-authentication#about-the-github_token-secret)
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_API_MODEL: "gpt-4" # Optional: defaults to "gpt-4"
          OPENAI_API_VERSION: ${{ vars.OPENAI_API_VERSION }}
          OPENAI_BASE_URL: ${{ vars.OPENAI_BASE_URL }}
          exclude: "**/*.json, **/*.md" # Optional: exclude patterns separated by commas
          include: "**/*.ts" # Optional: include patterns separated by commas
```

4. Customize the `exclude` input if you want to ignore certain file patterns from being reviewed.

5. Customize the `include` input if you want to add only certain file patterns to be reviewed. Any file matching the include and which also matches the `exclude` will favor the latter: `exclude` > `include`.

6. Commit the changes to your repository, and CDS AI Code Reviewer will start working on your future pull requests.

## How It Works

When used on `opened` and `synchronize` Github action triggers, the CDS AI Code Reviewer GitHub Action retrieves the pull request diff, filters out excluded files, and sends code chunks to the OpenAI API. It then generates review comments based on the AI's response and adds them to the pull request.

When used on the `push` Github action trigger, the CDS AI Code Reviewer GitHub Action checks if a commit message contains the `[review]` keyword and when it does, it then retrieves the pull request related to the commit message, filters out excluded files, and sends code chunks to the OpenAI API. It then generates review comments based on the AI's response and adds them to the pull request.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests to improve the CDS AI Code Reviewer GitHub
Action.

Let the maintainer generate the final package (`yarn build` & `yarn package`).

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for more information.
