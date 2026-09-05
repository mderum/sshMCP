# sshMCP

A Node.js-based Model Context Protocol (MCP) server that enables Claude/Cline to execute SSH commands remotely on servers. This MCP bridges the gap between Claude's capabilities and your remote infrastructure, allowing for seamless command execution, file operations, and server management.

## Features

- 🔐 **Secure SSH Connections** - Execute commands securely on remote servers using private key authentication
- 🚀 **Easy Integration** - Works with Claude Desktop and Cline with minimal configuration
- 📁 **File Operations** - Push, pull, and manage files on remote systems
- 🛠️ **Command Execution** - Run any shell command on your remote server
- ⚙️ **Configurable Defaults** - Set default hosts, ports, authentication, and paths
- 🔑 **Private Key Authentication** - Secure authentication using SSH private keys

## Prerequisites

- Node.js (v14 or higher)
- SSH private key with access to target servers
- Network access to your remote servers via SSH (port 22 or custom)

## Installation

1. Clone or download this repository to your MCP directory:
```bash
git clone <repository-url> /path/to/mcp/sshMCP
cd /path/to/mcp/sshMCP
```

2. Install dependencies:
```bash
npm install
```

## Configuration

Add the sshMCP server to your Cline or Claude Desktop configuration file. The server uses environment variables for default values.

### Claude Desktop Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sshMCP": {
      "command": "node",
      "args": ["/path/to/sshMCP/mcp-file-push.js"],
      "env": {
        "DEFAULT_HOST": "username@your.server.com",
        "DEFAULT_PRIVATE_KEY": "/path/to/ssh-key-prv.key",
        "DEFAULT_REMOTE_PATH": "/home/username/",
        "DEFAULT_PORT": "22"
      }
    }
  }
}
```

### Cline Configuration

Add to your Cline MCP server configuration:

```json
{
  "mcpServers": {
    "sshMCP": {
      "command": "node",
      "args": ["C:/mcp/sshMCP/mcp-file-push.js"],
      "env": {
        "DEFAULT_HOST": "ubuntu@00.00.00.00",
        "DEFAULT_PRIVATE_KEY": "C://ssh-key-prv.key",
        "DEFAULT_REMOTE_PATH": "/home/ubuntu/",
        "DEFAULT_PORT": "22"
      }
    }
  }
}
```

### Configuration Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `DEFAULT_HOST` | SSH host in `username@hostname` format | `ubuntu@192.168.1.100` |
| `DEFAULT_PRIVATE_KEY` | Path to your SSH private key file | `/home/user/.ssh/id_rsa` or `C://ssh-key-prv.key` |
| `DEFAULT_REMOTE_PATH` | Default remote directory for file operations | `/home/ubuntu/` |
| `DEFAULT_PORT` | SSH port (default is usually 22) | `22` or `2222` |

## Usage

Once configured, Claude/Cline can use the sshMCP to:

### Execute Remote Commands
```
Execute this command on the server: ls -la /home/ubuntu/
```

### Push Files to Server
```
Push this file to the server: /local/path/file.txt
```

### Pull Files from Server
```
Get this file from the server: /home/ubuntu/important-file.log
```

### Manage Server Operations
- Check server status
- Install packages
- Run deployment scripts
- Manage processes
- View logs

## SSH Key Setup

### Generate an SSH Key (if you don't have one)

```bash
ssh-keygen -t rsa -b 4096 -f ~/.ssh/id_rsa -N ""
```

### Add Public Key to Remote Server

```bash
ssh-copy-id -i ~/.ssh/id_rsa.pub user@remote-server
```

Or manually:

```bash
cat ~/.ssh/id_rsa.pub | ssh user@remote-server "cat >> ~/.ssh/authorized_keys"
```

### Permissions Setup

Ensure correct permissions on your remote server:

```bash
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

## Project Structure

```
sshMCP/
├── mcp-file-push.js      # Main MCP server file
├── package.json          # Node dependencies
├── README.md             # This file
└── .gitignore           # Git ignore rules
```

## Security Considerations

⚠️ **Important Security Notes:**

1. **Never commit private keys** to version control - add to `.gitignore`
2. **Restrict permissions** on your SSH private key:
   ```bash
   chmod 600 /path/to/ssh-key
   ```
3. **Use strong passphrases** for SSH keys
4. **Limit SSH access** using firewall rules and SSH configuration
5. **Monitor server logs** for unauthorized access attempts
6. **Use dedicated SSH keys** for automation (consider separate key per service)
7. **Rotate keys periodically** and update authorized_keys

## Troubleshooting

### Connection Refused
- Verify the host and port are correct
- Check if SSH service is running on the remote server
- Confirm network connectivity with `ping` or `nc`

### Permission Denied (publickey)
- Ensure your public key is in `~/.ssh/authorized_keys` on the remote server
- Verify SSH key file permissions are `600`
- Check that the username matches your SSH key

### Key Not Found
- Verify the path to your private key is correct
- Ensure the file exists and is readable
- Check for typos in environment variable paths

### Timeout Errors
- Check network connectivity to the remote server
- Verify firewall rules allow SSH traffic
- Increase SSH timeout values if needed

## Supported Commands

The MCP can execute any command available in your remote server's shell, including:

- System commands (ls, cd, mkdir, rm, etc.)
- Package managers (apt, yum, npm, pip, etc.)
- Development tools (git, docker, etc.)
- Custom scripts and applications
- Database clients (psql, mysql, etc.)

## Development

### Install Dependencies
```bash
npm install
```

### Testing
To test your configuration:

```bash
ssh -i /path/to/key username@hostname "echo 'Connection successful'"
```

## License

[Add your license here]

## Support

For issues, questions, or contributions, please [open an issue](../../issues) or submit a pull request.

## Changelog

### Version 1.0.0
- Initial release
- SSH command execution support
- File push/pull capabilities
- Configurable defaults via environment variables
