import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const DEFAULT_HOST = process.env.DEFAULT_HOST || "";
const DEFAULT_PRIVATE_KEY = process.env.DEFAULT_PRIVATE_KEY || "";
const DEFAULT_REMOTE_PATH = process.env.DEFAULT_REMOTE_PATH || "";
const DEFAULT_PORT = process.env.DEFAULT_PORT || "22";

const server = new Server(
  { name: "file-push-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// Patterns for commands we refuse to run. NOTE: this is a blocklist, not a
// sandbox — it catches obvious destructive commands (rm, del, formatting,
// output redirection that could overwrite/truncate files) but can be
// bypassed by creative workarounds (e.g. invoking an interpreter to delete
// files, using find -delete, piping through xargs, etc.). Treat this as a
// safety net for accidental destructive commands, not a security boundary
// against adversarial input.
const BLOCKED_PATTERNS = [
  /\brm\b/i,
  /\bdel\b/i,
  /\bdelete\b/i,
  /\brmdir\b/i,
  /\bunlink\b/i,
  /\bshred\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\btruncate\b/i,
  />\s*[^&]/, // output redirection that could overwrite/truncate files
  /\bformat\b/i,
];

function isCommandBlocked(command) {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

const tools = [
  {
    name: "push_file",
    description: "Push a file to a remote server via HTTP POST",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Local file path to push (absolute or relative)",
        },
        serverUrl: {
          type: "string",
          description: "Server endpoint URL, example https://example.com/upload",
        },
        authToken: {
          type: "string",
          description: "Optional Bearer token for authentication",
        },
        fieldName: {
          type: "string",
          description: "Form field name for the file, default is file",
        },
      },
      required: ["filePath", "serverUrl"],
    },
  },
  {
    name: "push_folder_ssh",
    description: "Push an entire folder to a server via SSH recursively",
    inputSchema: {
      type: "object",
      properties: {
        folderPath: {
          type: "string",
          description: "Local folder path to push",
        },
        host: {
          type: "string",
          description: "SSH host, example ubuntu@54.123.45.67",
        },
        remotePath: {
          type: "string",
          description: "Remote destination folder path, example /home/ubuntu/myfolder",
        },
        privateKeyPath: {
          type: "string",
          description: "Path to private SSH key",
        },
        port: {
          type: "string",
          description: "SSH port, default is 22",
        },
      },
      required: ["folderPath", "host", "remotePath", "privateKeyPath"],
    },
  },
  {
    name: "push_file_ssh",
    description: "Push a file to a server via SSH SCP",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Local file path to push",
        },
        host: {
          type: "string",
          description: "SSH host, example ubuntu@54.123.45.67",
        },
        remotePath: {
          type: "string",
          description: "Remote destination path, example /home/ubuntu/",
        },
        privateKeyPath: {
          type: "string",
          description: "Path to private SSH key",
        },
        port: {
          type: "string",
          description: "SSH port, default is 22",
        },
      },
      required: ["filePath"],
    },
  },
  {
    name: "list_files",
    description: "List files in a local directory",
    inputSchema: {
      type: "object",
      properties: {
        dirPath: {
          type: "string",
          description: "Directory path to list",
        },
      },
      required: ["dirPath"],
    },
  },
  {
    name: "execute_command",
    description:
      "Execute a shell command locally, or remotely over SSH if host/privateKeyPath are provided. Destructive commands (rm, del, delete, format, output redirection, etc.) are blocked.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        cwd: {
          type: "string",
          description:
            "Local working directory to run the command in (local mode only), defaults to current directory",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in milliseconds, default 30000",
        },
        host: {
          type: "string",
          description:
            "SSH host, example ubuntu@54.123.45.67. If provided (or a default is configured), the command runs remotely via SSH instead of locally.",
        },
        remotePath: {
          type: "string",
          description: "Remote working directory to run the command in (SSH mode only)",
        },
        privateKeyPath: {
          type: "string",
          description: "Path to private SSH key (SSH mode only)",
        },
        port: {
          type: "string",
          description: "SSH port, default is 22 (SSH mode only)",
        },
      },
      required: ["command"],
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = request.params.arguments || {};

  try {
    if (name === "push_file") {
      return await handlePushFileHttp(args);
    }
    if (name === "push_folder_ssh") {
      return await handlePushFolderSsh(args);
    }
    if (name === "push_file_ssh") {
      return await handlePushFileSsh(args);
    }
    if (name === "list_files") {
      return await handleListFiles(args);
    }
    if (name === "execute_command") {
      return await handleExecuteCommand(args);
    }
    return {
      content: [{ type: "text", text: "Unknown tool: " + name }],
      isError: true,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "Error: " + error.message }],
      isError: true,
    };
  }
});

async function handlePushFileHttp(args) {
  const filePath = args.filePath;
  const serverUrl = args.serverUrl;
  const authToken = args.authToken;
  const fieldName = args.fieldName || "file";

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      content: [{ type: "text", text: "File not found: " + resolvedPath }],
      isError: true,
    };
  }

  try {
    const fileStream = fs.createReadStream(resolvedPath);
    const formData = new FormData();
    formData.append(fieldName, fileStream, path.basename(resolvedPath));

    const headers = formData.getHeaders();
    if (authToken) {
      headers["Authorization"] = "Bearer " + authToken;
    }

    const response = await axios.post(serverUrl, formData, {
      headers: headers,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return {
      content: [
        {
          type: "text",
          text:
            "File pushed successfully to " +
            serverUrl +
            "\nStatus: " +
            response.status +
            "\nResponse: " +
            JSON.stringify(response.data),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "Failed to push file: " + error.message }],
      isError: true,
    };
  }
}

async function handlePushFileSsh(args) {
  const filePath = args.filePath;
  const host = args.host || DEFAULT_HOST;
  const remotePath = args.remotePath || DEFAULT_REMOTE_PATH;
  const privateKeyPath = args.privateKeyPath || DEFAULT_PRIVATE_KEY;
  const port = args.port || DEFAULT_PORT;

  try {
    const nodeSshModule = await import("node-ssh");
    const NodeSSH = nodeSshModule.NodeSSH;
    const ssh = new NodeSSH();

    const resolvedKeyPath = path.resolve(privateKeyPath);
    const resolvedFilePath = path.resolve(filePath);

    if (!fs.existsSync(resolvedKeyPath)) {
      return {
        content: [{ type: "text", text: "Private key not found: " + resolvedKeyPath }],
        isError: true,
      };
    }

    if (!fs.existsSync(resolvedFilePath)) {
      return {
        content: [{ type: "text", text: "File not found: " + resolvedFilePath }],
        isError: true,
      };
    }

    const atIndex = host.indexOf("@");
    const username = atIndex >= 0 ? host.substring(0, atIndex) : "root";
    const hostAddress = atIndex >= 0 ? host.substring(atIndex + 1) : host;

    await ssh.connect({
      host: hostAddress,
      username: username,
      privateKey: fs.readFileSync(resolvedKeyPath, "utf8"),
      port: parseInt(port, 10),
    });

    await ssh.putFile(resolvedFilePath, remotePath);
    ssh.dispose();

    return {
      content: [
        {
          type: "text",
          text: "File pushed via SSH to " + host + ":" + remotePath,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "SSH push failed: " + error.message }],
      isError: true,
    };
  }
}

async function handleListFiles(args) {
  const dirPath = args.dirPath;

  try {
    const resolvedPath = path.resolve(dirPath);

    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [{ type: "text", text: "Directory not found: " + resolvedPath }],
        isError: true,
      };
    }

    const files = fs.readdirSync(resolvedPath);
    const fileDetails = files.map(function (file) {
      const fullPath = path.join(resolvedPath, file);
      const stat = fs.statSync(fullPath);
      const label = stat.isDirectory() ? "DIR" : stat.size + " bytes";
      return file + " - " + label;
    });

    return {
      content: [
        {
          type: "text",
          text: "Files in " + resolvedPath + ":\n" + fileDetails.join("\n"),
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "Failed to list files: " + error.message }],
      isError: true,
    };
  }
}

async function handlePushFolderSsh(args) {
  const folderPath = args.folderPath;
  const host = args.host || DEFAULT_HOST;
  const remotePath = args.remotePath || DEFAULT_REMOTE_PATH;
  const privateKeyPath = args.privateKeyPath || DEFAULT_PRIVATE_KEY;
  const port = args.port || DEFAULT_PORT;

  try {
    const nodeSshModule = await import("node-ssh");
    const NodeSSH = nodeSshModule.NodeSSH;
    const ssh = new NodeSSH();

    const resolvedKeyPath = path.resolve(privateKeyPath);
    const resolvedFolderPath = path.resolve(folderPath);

    if (!fs.existsSync(resolvedKeyPath)) {
      return {
        content: [{ type: "text", text: "Private key not found: " + resolvedKeyPath }],
        isError: true,
      };
    }

    if (!fs.existsSync(resolvedFolderPath)) {
      return {
        content: [{ type: "text", text: "Folder not found: " + resolvedFolderPath }],
        isError: true,
      };
    }

    const atIndex = host.indexOf("@");
    const username = atIndex >= 0 ? host.substring(0, atIndex) : "root";
    const hostAddress = atIndex >= 0 ? host.substring(atIndex + 1) : host;

    await ssh.connect({
      host: hostAddress,
      username: username,
      privateKey: fs.readFileSync(resolvedKeyPath, "utf8"),
      port: parseInt(port, 10),
    });

    let uploadedCount = 0;
    let failedCount = 0;

    const status = await ssh.putDirectory(resolvedFolderPath, remotePath, {
      recursive: true,
      concurrency: 5,
      tick: function (localPath, remoteFilePath, error) {
        if (error) {
          failedCount = failedCount + 1;
        } else {
          uploadedCount = uploadedCount + 1;
        }
      },
    });

    ssh.dispose();

    return {
      content: [
        {
          type: "text",
          text:
            "Folder push finished. Success: " +
            status +
            ", Files uploaded: " +
            uploadedCount +
            ", Files failed: " +
            failedCount +
            ", Remote path: " +
            remotePath,
        },
      ],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "SSH folder push failed: " + error.message }],
      isError: true,
    };
  }
}

async function handleExecuteCommand(args) {
  const command = args.command;
  const timeoutMs = args.timeoutMs || 30000;

  if (!command || typeof command !== "string") {
    return {
      content: [{ type: "text", text: "No command provided" }],
      isError: true,
    };
  }

  if (isCommandBlocked(command)) {
    return {
      content: [
        {
          type: "text",
          text:
            "Blocked: command matched a destructive-operation pattern and was not run.\nCommand: " +
            command,
        },
      ],
      isError: true,
    };
  }

  const host = args.host || DEFAULT_HOST;
  const privateKeyPath = args.privateKeyPath || DEFAULT_PRIVATE_KEY;

  // Remote mode: run over SSH if a host/key is given or configured via env defaults.
  if (host && privateKeyPath) {
    return await handleExecuteCommandSsh(args, host, privateKeyPath, timeoutMs);
  }

  // Local mode: fall back to running on this machine.
  const cwd = args.cwd ? path.resolve(args.cwd) : process.cwd();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      content: [
        {
          type: "text",
          text:
            "Command executed locally.\ncwd: " +
            cwd +
            "\n\nstdout:\n" +
            (stdout || "(empty)") +
            "\n\nstderr:\n" +
            (stderr || "(empty)"),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text:
            "Command failed locally.\ncwd: " +
            cwd +
            "\nError: " +
            error.message +
            (error.stdout ? "\n\nstdout:\n" + error.stdout : "") +
            (error.stderr ? "\n\nstderr:\n" + error.stderr : ""),
        },
      ],
      isError: true,
    };
  }
}

async function handleExecuteCommandSsh(args, host, privateKeyPath, timeoutMs) {
  const command = args.command;
  const remotePath = args.remotePath || DEFAULT_REMOTE_PATH;
  const port = args.port || DEFAULT_PORT;

  try {
    const nodeSshModule = await import("node-ssh");
    const NodeSSH = nodeSshModule.NodeSSH;
    const ssh = new NodeSSH();

    const resolvedKeyPath = path.resolve(privateKeyPath);

    if (!fs.existsSync(resolvedKeyPath)) {
      return {
        content: [{ type: "text", text: "Private key not found: " + resolvedKeyPath }],
        isError: true,
      };
    }

    const atIndex = host.indexOf("@");
    const username = atIndex >= 0 ? host.substring(0, atIndex) : "root";
    const hostAddress = atIndex >= 0 ? host.substring(atIndex + 1) : host;

    await ssh.connect({
      host: hostAddress,
      username: username,
      privateKey: fs.readFileSync(resolvedKeyPath, "utf8"),
      port: parseInt(port, 10),
    });

    const result = await ssh.execCommand(command, {
      cwd: remotePath || undefined,
      execOptions: { timeout: timeoutMs },
    });

    ssh.dispose();

    return {
      content: [
        {
          type: "text",
          text:
            "Command executed via SSH on " +
            host +
            (remotePath ? " in " + remotePath : "") +
            "\nExit code: " +
            result.code +
            "\n\nstdout:\n" +
            (result.stdout || "(empty)") +
            "\n\nstderr:\n" +
            (result.stderr || "(empty)"),
        },
      ],
      isError: result.code !== 0,
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: "SSH command execution failed: " + error.message }],
      isError: true,
    };
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP file push server started");
