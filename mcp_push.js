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
  },
  {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'push_files',
      arguments: {
        owner: 'JoelA510',
        repo: 'SquadLogic',
        branch: 'main',
        files: filesToPush,
        message: 'Push current updates'
      }
    }
  }
];

let stdoutBuf = '';
serverProc.stdin.write(JSON.stringify(requests[0]) + '\n');

serverProc.stdout.on('data', chunk => {
  stdoutBuf += chunk.toString();
  let msgs = stdoutBuf.split('\n');
  stdoutBuf = msgs.pop();
  
  for (const msg of msgs) {
    if (!msg.trim()) continue;
    try {
      const parsed = JSON.parse(msg);
      if (parsed.id === 1) {
        serverProc.stdin.write(JSON.stringify(requests[1]) + '\n');
        serverProc.stdin.write(JSON.stringify(requests[2]) + '\n');
        console.log("Sent push request with", filesToPush.length, "files");
      } else if (parsed.id === 2) {
        console.log("TOOL RESPONSE:", JSON.stringify(parsed, null, 2));
        process.exit(0);
      }
    } catch(e) {}
  }
});

serverProc.stderr.on('data', d => {
  console.error('stderr:', d.toString());
});
