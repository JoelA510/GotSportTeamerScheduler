import { spawn } from 'child_process';
import fs from 'fs';

const mcpConfig = JSON.parse(fs.readFileSync('C:\\Users\\joel.abraham\\.gemini\\antigravity\\mcp_config.json', 'utf8'));
const githubConfig = mcpConfig.mcpServers.github;

// Start the MCP server process
const serverProc = spawn(githubConfig.command, githubConfig.args, {
  env: { ...process.env, ...githubConfig.env },
  shell: true
});

const changedFilesList = fs.readFileSync('changed_files.txt', 'utf8')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.includes('.temp') && !l.includes('.png'));

const filesToPush = [];
for (const file of changedFilesList) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    filesToPush.push({ path: file, content });
  } catch (e) {
    console.error(`Skipping ${file}: ${e.message}`);
  }
}

const requests = [
  {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'cli', version: '1' }
    }
  },
  {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }
];

let stdoutBuf = '';

async function runBatches() {
  const BATCH_SIZE = 10; // Even smaller batch size to be safe
  for (let i = 0; i < filesToPush.length; i += BATCH_SIZE) {
    const batch = filesToPush.slice(i, i + BATCH_SIZE);
    console.log(`Sending batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(filesToPush.length / BATCH_SIZE)}...`);
    
    await new Promise((resolve, reject) => {
      const requestId = 100 + i;
      const pushRequest = {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: 'push_files',
          arguments: {
            owner: 'JoelA510',
            repo: 'SquadLogic',
            branch: 'main',
            files: batch,
            message: `Phase 3 updates (batch ${Math.floor(i / BATCH_SIZE) + 1})`
          }
        }
      };

      const handleResponse = (msg) => {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.id === requestId) {
            if (parsed.error) {
              console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, JSON.stringify(parsed.error, null, 2));
              // Continue anyway? Or stop? Let's just log and continue for now.
              resolve();
            } else {
              console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} succeeded.`);
              resolve();
            }
          }
        } catch (e) {}
      };

      const onData = (chunk) => {
        let msgs = (stdoutBuf + chunk.toString()).split('\n');
        stdoutBuf = msgs.pop();
        for (const m of msgs) handleResponse(m);
      };

      serverProc.stdout.on('data', onData);
      serverProc.stdin.write(JSON.stringify(pushRequest) + '\n');
    });
  }
  console.log("All batches finished.");
  process.exit(0);
}

serverProc.stdin.write(JSON.stringify(requests[0]) + '\n');

serverProc.stdout.on('data', function initHandler(chunk) {
  stdoutBuf += chunk.toString();
  let msgs = stdoutBuf.split('\n');
  stdoutBuf = msgs.pop();
  
  for (const msg of msgs) {
    if (!msg.trim()) continue;
    try {
      const parsed = JSON.parse(msg);
      if (parsed.id === 1) {
        serverProc.stdin.write(JSON.stringify(requests[1]) + '\n');
        serverProc.stdout.removeListener('data', initHandler);
        runBatches();
      }
    } catch(e) {}
  }
});

serverProc.stderr.on('data', d => {
  // Silence noise
});
