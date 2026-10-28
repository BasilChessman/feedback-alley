// Production server: serves the built app from dist/ plus the API.
//   PORT=8090 HOST=0.0.0.0 DATA_DIR=./data npm start

import path from 'node:path';
import { lanUrls, rootDir, startServer } from './app.js';

const port = parseInt(process.env.PORT || '8090', 10);
const host = process.env.HOST || '0.0.0.0';
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));

try {
  await startServer({ port, host, dataDir });
  console.log(`Feedback Alley editor running:`);
  console.log(`  http://localhost:${port}/`);
  for (const url of lanUrls(port)) console.log(`  ${url}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
