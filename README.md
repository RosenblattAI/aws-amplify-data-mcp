# Amplify Data API MCP Server

This MCP (Model Context Protocol) server lets you interact with your AWS Amplify Gen2 application's data through natural language. It allows AI assistants like Claude to perform operations on your Amplify data models using conversational language instead of complex code or commands.

## Features

- 💬 **Natural Language Interface**: Ask questions and give instructions in plain English
- 🔍 **View Schema Information**: List models, view field details, and explore relationships
- 📊 **Query Data**: Run custom GraphQL queries to list and retrieve your data
- ✏️ **Modify Data**: Create, update, and delete records through GraphQL mutations
- 🔐 **Secure Authentication**: Uses Cognito authentication with environment variables

## Important Authentication Requirements

This MCP server uses Cognito authentication to access your Amplify data. **Your Amplify project must be configured to use Cognito-based authentication.** The server will only have access to data models and records that the authenticated user has permission to access.

For optimal functionality, we strongly recommend:

1. Creating an **ADMINS** user group in your Cognito user pool
2. Adding appropriate users to this group
3. Configuring your Amplify models with permissions that allow the ADMINS group to perform all operations

Example model authorization for admin access:

```javascript
// In your Amplify model definition
authorization: (allow) => [
  allow.authenticated().to(["read"]),
  allow.group("ADMINS").to(["create", "read", "update", "delete"]),
];
```

Without proper admin permissions, the MCP server will be limited in what it can do with your data.

## Setup Instructions

### Prerequisites

- Node.js v16 or higher
- An AWS Amplify Gen2 app with data models
- Access to your Amplify outputs file (`amplify_outputs.json`)
- Cognito authentication configured in your Amplify app
- A user with appropriate permissions (ideally in the ADMINS group)

### Installation

1. **Clone the repository**:

   ```bash
   git clone https://github.com/dbsmith7491/aws-amplify-data-mcp.git
   cd aws-amplify-data-mcp
   ```

2. **Install dependencies**:

   ```bash
   npm install
   ```

3. **Build the project**:
   ```bash
   npm run build
   ```

### Configuration for Claude Desktop

To use this with Claude Desktop:

1. **Open Claude Desktop configuration file**:

   - Mac/Linux: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%AppData%\Claude\claude_desktop_config.json`

   Create the file if it doesn't exist.

2. **Add the Amplify MCP server configuration**:

   ```json
   {
     "mcpServers": {
       "amplify-data-api": {
         "command": "node",
         "args": [
           "/ABSOLUTE/PATH/TO/aws-amplify-data-mcp/build/index.js",
           "--amplify-outputs",
           "/ABSOLUTE/PATH/TO/YOUR/amplify_outputs.json"
         ],
         "env": {
           "AMPLIFY_USERNAME": "your-admin-username",
           "AMPLIFY_PASSWORD": "your-admin-password"
         }
       }
     }
   }
   ```

   Replace the paths and credentials with your own. **For full functionality, use credentials for a user in the ADMINS group.**

3. **Restart Claude Desktop**

## Using Natural Language with Your Data

Once configured, you can interact with your Amplify data using everyday language in Claude. Simply include the `@amplify-data-api` tag at the beginning of your message to direct your question to the Amplify server.

### Natural Language Examples

Here are some examples of how you can interact with your data:

- "**@amplify-data-api** What data models do I have in my application?"
- "**@amplify-data-api** Show me what fields the Story model has"
- "**@amplify-data-api** Can you list all stories in my database?"
- "**@amplify-data-api** Find stories that have 'adventure' in the title"
- "**@amplify-data-api** Create a new character named 'Claude' who is an AI assistant"
- "**@amplify-data-api** Update the story with ID 'abc123' to change its title to 'The Journey Begins'"
- "**@amplify-data-api** Delete the Story with ID 'xyz789'"
- "**@amplify-data-api** What's the relationship between Characters and Stories?"
- "**@amplify-data-api** Show me all the characters in story 'abc123'"
- "**@amplify-data-api** How many stories have been created in the last month?"

Claude will interpret these natural language requests and convert them into the appropriate GraphQL queries and mutations.

## Available Tools

The server provides the following tools:

1. **List all data models**:

   - Lists all available data models in your Amplify app

2. **Get model details**:

   - Shows detailed information about a specific model's fields and relationships

3. **Run GraphQL queries and mutations**:

   - Execute custom GraphQL queries and mutations for maximum flexibility
   - Handles all data operations (list, get, create, update, delete)

4. **Get relationship details**:

   - Shows relationships between models for complex data structures

5. **List enums**:

   - Shows all enum types available in your data models

6. **Manual login** (if needed):
   - Authenticate manually if automatic authentication fails

## Example Conversations

Here's how a typical conversation with Claude might flow:

> **You**: @amplify-data-api What data models do I have available?
>
> **Claude**: I'll check your Amplify app for available data models.
>
> I found the following models:
>
> - Story
> - Character
> - Location
> - World
>   [more details about each model...]
>
> **You**: @amplify-data-api Tell me about the Story model
>
> **Claude**: Here are the details for the Story model:
>
> Fields:
>
> - id: ID (required)
> - title: String (required)
> - description: String
> - numberOfPages: Int
>   [other fields...]
>
> **You**: @amplify-data-api Can you create a new Story called "Claude's Adventure" about an AI exploring a magical world?
>
> **Claude**: I'll create that Story for you using a GraphQL mutation. Here's what I'll submit:
>
> ```graphql
> mutation CreateStory {
>   createStory(
>     input: {
>       title: "Claude's Adventure"
>       description: "A tale about an AI exploring a magical world"
>       status: "draft"
>     }
>   ) {
>     id
>     title
>     description
>     status
>     createdAt
>     updatedAt
>   }
> }
> ```
>
> **You**: Yes, please create it
>
> **Claude**: I've created the Story! Here's the new record:
>
> ```json
> {
>   "id": "abc123",
>   "title": "Claude's Adventure",
>   "description": "A tale about an AI exploring a magical world",
>   "status": "draft",
>   "createdAt": "2023-06-15T10:30:45Z",
>   "updatedAt": "2023-06-15T10:30:45Z"
> }
> ```
>
> **You**: @amplify-data-api Now let's add a character to this story
>
> **Claude**: [continues the interaction naturally...]

## Security Considerations

- **Credentials in Environment Variables**: Uses environment variables for better security of credentials
- **Permissions**: Use appropriate Cognito groups to control access (ADMINS group for full access)
- **Data Sensitivity**: Be mindful of what data you access through AI assistants
- **Access Control**: The MCP server can only access data that the authenticated user has permission to access
- **User Roles**: For full functionality, use credentials for a user with admin privileges

## Troubleshooting

- **Authentication Issues**: Verify your Cognito credentials and user pool settings
- **Missing Models**: Ensure your amplify_outputs.json file is up-to-date
- **Connection Problems**: Check Claude Desktop logs for errors
- **Permissions Errors**: Verify your user has appropriate permissions in Cognito
- **Limited Access**: If you can't see certain models or records, check if your user has permission to access them

## For Developers

- TypeScript source is in the `src/` directory
- Compiled JavaScript is output to `build/`
- Run `npm run build` after any source code changes

## Distribution as a ZIP File

If you receive this project as a ZIP file, follow these steps to get it working:

1. **Extract the ZIP file** to a directory on your computer
2. **Open a terminal** and navigate to the extracted directory
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Build the project**:
   ```bash
   npm run build
   ```
5. **Configure Claude Desktop** with the correct paths and environment variables as shown in the "Configuration for Claude Desktop" section above
6. **Restart Claude Desktop** to apply the changes

If you want to distribute this project to others:

1. **Ensure all changes are committed**
2. **Include all necessary files**:
   - `src/` directory with all TypeScript source files
   - `package.json` and other configuration files
   - This README.md file
   - (Optionally) the `build/` directory if you've already built the project
3. **Create a ZIP file** of the entire directory
4. **Share the ZIP file** with instructions to follow the steps above

## Command Line Options

```
Options:
  --amplify-outputs <path>   Path to the amplify_outputs.json file
  --help, -h                 Show this help message

Environment Variables:
  AMPLIFY_USERNAME           Cognito username for automatic login
  AMPLIFY_PASSWORD           Cognito password for automatic login
```

## Additional Resources

- [Amplify Gen2 Documentation](https://docs.amplify.aws/gen2/)
- [Amplify Authentication Documentation](https://docs.amplify.aws/gen2/build-a-backend/auth/)
- [Model Context Protocol Documentation](https://modelcontextprotocol.io/)
- [Claude Desktop Documentation](https://claude.ai/desktop)

---

Need more help? Contact your development team for support.
