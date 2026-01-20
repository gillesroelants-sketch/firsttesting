# Page Quality Analyzer

A small local tool to analyze a webpage for broken links, unnecessary/placeholder links, and response times per resource.

## Requirements
- Node.js 18+ (or a recent Node)
- npm

## Install
1. Clone or copy the files into a directory.
2. Install dependencies:
```bash
npm install
```

## Run
```bash
npm start
```
Open http://localhost:3000 in your browser.

## How it works
- Enter a full URL (including https://) in the text box and click Analyze.
- The server fetches the page and extracts anchors, images, scripts, stylesheets, iframes, and meta-refresh targets.
- Each resource is checked (HEAD then fallback to GET-stream), and the response time and HTTP status are recorded.
- The UI shows a summary and a detailed list with recommendations.

## Notes and possible improvements
- The server limits resource checks (default 300) to avoid accidental heavy scans.
- No crawling beyond the initial page is performed.
- If you want deeper scans (multiple levels), CSV export, or a deployable Docker image, tell me and I can add it.
