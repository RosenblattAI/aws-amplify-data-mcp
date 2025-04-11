#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { Auth } from "@aws-amplify/auth";
// Parse command line arguments
const args = process.argv.slice(2);
let amplifyOutputsPath = null;
// Read credentials from environment variables instead of command line
const username = process.env.AMPLIFY_USERNAME || null;
const password = process.env.AMPLIFY_PASSWORD || null;
// Look for the amplify outputs path argument
for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--amplify-outputs") {
        amplifyOutputsPath = args[++i];
    }
    else if (arg === "--help" || arg === "-h") {
        console.log(`
Amplify Data API MCP Server

Options:
  --amplify-outputs <path>   Path to the amplify_outputs.json file
  --help, -h                 Show this help message

Environment Variables:
  AMPLIFY_USERNAME           Cognito username for automatic login
  AMPLIFY_PASSWORD           Cognito password for automatic login
    `);
        process.exit(0);
    }
}
// Validate amplify outputs path
if (!amplifyOutputsPath) {
    console.error("Error: Amplify outputs path is required (--amplify-outputs <path>)");
    process.exit(1);
}
// Resolve to absolute path
const absolutePath = path.resolve(process.cwd(), amplifyOutputsPath);
// Check if file exists
if (!fs.existsSync(absolutePath)) {
    console.error(`Error: Amplify outputs file not found at ${absolutePath}`);
    process.exit(1);
}
console.log(`Starting Amplify Data API MCP server with outputs file: ${absolutePath}`);
// Load the Amplify outputs file
let amplifyOutputs;
try {
    const fileContent = fs.readFileSync(absolutePath, "utf8");
    amplifyOutputs = JSON.parse(fileContent);
}
catch (error) {
    console.error(`Error reading Amplify outputs file: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
}
// Extract key information from outputs
const apiUrl = amplifyOutputs.data?.url;
const region = amplifyOutputs.data?.aws_region || "us-east-1";
const defaultAuthType = amplifyOutputs.data?.default_authorization_type || "API_KEY";
const authTypes = amplifyOutputs.data?.authorization_types || [];
const models = amplifyOutputs.data?.model_introspection?.models || {};
const enums = amplifyOutputs.data?.model_introspection?.enums || {};
// Validate required fields
if (!apiUrl) {
    console.error("Error: Missing API URL in Amplify outputs file");
    process.exit(1);
}
// Initialize authentication with Cognito if available
let isAuthInitialized = false;
if (amplifyOutputs.auth) {
    const { user_pool_id, aws_region: authRegion, user_pool_client_id, identity_pool_id, } = amplifyOutputs.auth;
    if (user_pool_id && user_pool_client_id) {
        try {
            Auth.configure({
                region: authRegion || region,
                userPoolId: user_pool_id,
                userPoolWebClientId: user_pool_client_id,
                identityPoolId: identity_pool_id,
            });
            isAuthInitialized = true;
            console.log("Cognito authentication configured successfully");
        }
        catch (error) {
            console.error(`Error configuring Cognito authentication: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
// Create server instance
const server = new McpServer({
    name: "amplify-data-api",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
// Current authentication state
let currentUser = null;
let idToken = null;
// Store credentials globally for re-login purposes
let storedUsername = null;
let storedPassword = null;
// Helper function to make authenticated GraphQL requests
async function executeGraphQLQuery(query, variables = {}) {
    const headers = {
        "Content-Type": "application/json",
    };
    // Add authentication header if available
    if (idToken) {
        headers["Authorization"] = idToken;
    }
    try {
        const response = await fetch(apiUrl, {
            method: "POST",
            headers,
            body: JSON.stringify({
                query,
                variables,
            }),
        });
        // Check for 401 Unauthorized status specifically
        if (response.status === 401) {
            console.error("Received 401 Unauthorized, attempting to refresh authentication");
            return await handleAuthRefresh(query, variables);
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const result = await response.json();
        // Also check response for auth errors
        if (result.errors &&
            result.errors.some((e) => e.errorType === "UnauthorizedException" ||
                e.message?.includes("Authentication failed") ||
                e.message?.includes("token is expired"))) {
            console.error("Authentication error in GraphQL response");
            return await handleAuthRefresh(query, variables);
        }
        return result;
    }
    catch (error) {
        console.error("Error executing GraphQL query:", error);
        throw error;
    }
}
// Separate function to handle authentication refresh and retry
async function handleAuthRefresh(query, variables = {}) {
    // Try to refresh session or re-login
    if (isAuthInitialized) {
        try {
            console.error("Attempting to refresh session...");
            // First try to refresh the session without parameters
            await Auth.currentSession();
            const session = await Auth.currentSession();
            idToken = session.getIdToken().getJwtToken();
            console.error("Session refreshed successfully");
            // Retry the query with the new token
            return executeGraphQLQuery(query, variables);
        }
        catch (refreshError) {
            console.error("Session refresh failed:", refreshError);
            // If we have stored or environment credentials, try to login again
            const loginUsername = storedUsername || username;
            const loginPassword = storedPassword || password;
            if (loginUsername && loginPassword) {
                try {
                    console.error(`Attempting re-login for user: ${loginUsername}`);
                    const user = await Auth.signIn(loginUsername, loginPassword);
                    currentUser = user;
                    const session = await Auth.currentSession();
                    idToken = session.getIdToken().getJwtToken();
                    console.error("Re-login successful");
                    // Retry the query with the new token
                    return executeGraphQLQuery(query, variables);
                }
                catch (loginError) {
                    console.error("Re-login failed:", loginError);
                    throw new Error("Authentication expired and automatic re-login failed");
                }
            }
            else {
                throw new Error("Authentication expired and no stored credentials for re-login");
            }
        }
    }
    else {
        throw new Error("Authentication system not initialized");
    }
}
// Utility function to generate GraphQL fields for a model
function generateGraphQLFields(modelName, depth = 0) {
    if (depth > 1)
        return "id"; // Reduced depth limit from 2 to 1
    const model = models[modelName];
    if (!model)
        return "id";
    const fields = Object.entries(model.fields)
        .map(([fieldName, field]) => {
        // Skip read-only fields for mutations
        if (field.isReadOnly)
            return null;
        // Handle scalar fields
        if (!field.type.model && !field.type.enum) {
            return fieldName;
        }
        // Handle enum fields
        if (field.type.enum) {
            return fieldName;
        }
        // Handle model associations - simplified to avoid complex relationships
        if (field.type.model) {
            // For connections and arrays, just include the ID to avoid validation errors
            if (depth >= 1 || field.isArray) {
                return null; // Skip nested connections entirely
            }
            // For direct associations at depth 0, include only id and basic fields
            return `${fieldName} { id name }`;
        }
        return null;
    })
        .filter(Boolean);
    return fields.join("\n");
}
// Tool: Authenticate with Cognito
server.tool("login", "Login with Cognito username and password", {
    username: z.string().describe("Cognito username (usually email)"),
    password: z.string().describe("Cognito password"),
}, async ({ username, password }) => {
    if (!isAuthInitialized) {
        return {
            content: [
                {
                    type: "text",
                    text: "Error: Cognito authentication is not configured",
                },
            ],
        };
    }
    try {
        const user = await Auth.signIn(username, password);
        currentUser = user;
        // Get the current session to extract tokens
        const session = await Auth.currentSession();
        idToken = session.getIdToken().getJwtToken();
        // Store credentials for potential re-login
        storedUsername = username;
        storedPassword = password;
        return {
            content: [
                {
                    type: "text",
                    text: `Successfully logged in as ${username}`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Login failed: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
});
// Tool: Get current user info
server.tool("get-current-user", "Get information about the currently logged in user", {}, async () => {
    if (!currentUser) {
        return {
            content: [
                {
                    type: "text",
                    text: "Not logged in. Use the login tool to authenticate first.",
                },
            ],
        };
    }
    try {
        // Get the current authenticated user
        const userInfo = await Auth.currentUserInfo();
        return {
            content: [
                {
                    type: "text",
                    text: `Current User:\n${JSON.stringify(userInfo, null, 2)}`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error getting user info: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
});
// Tool: List all data models
server.tool("list-models", "List all data models in the Amplify app", {}, async () => {
    if (Object.keys(models).length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "No data models found in the Amplify outputs file",
                },
            ],
        };
    }
    const modelDetailsArray = Object.entries(models).map(([name, model]) => {
        const fields = Object.entries(model.fields)
            .map(([fieldName, field]) => {
            const typeInfo = field.type.model
                ? `${field.type.model} (model)`
                : field.type.enum
                    ? `${field.type.enum} (enum)`
                    : field.type;
            return `  - ${fieldName}: ${typeInfo}${field.isRequired ? " (required)" : ""}${field.isArray ? " (array)" : ""}`;
        })
            .join("\n");
        return `Model: ${name}\nFields:\n${fields}`;
    });
    return {
        content: [
            {
                type: "text",
                text: `Data Models:\n\n${modelDetailsArray.join("\n\n")}`,
            },
        ],
    };
});
// Tool: List all enums
server.tool("list-enums", "List all enum types in the Amplify app", {}, async () => {
    if (Object.keys(enums).length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: "No enum types found in the Amplify outputs file",
                },
            ],
        };
    }
    const enumDetailsArray = Object.entries(enums).map(([name, enumType]) => {
        const values = enumType.values
            .map((value) => `  - ${value}`)
            .join("\n");
        return `Enum: ${name}\nValues:\n${values}`;
    });
    return {
        content: [
            {
                type: "text",
                text: `Enum Types:\n\n${enumDetailsArray.join("\n\n")}`,
            },
        ],
    };
});
// Tool: Get model details
server.tool("get-model-details", "Get detailed information about a specific data model", {
    modelName: z.string().describe("Name of the model to get details for"),
}, async ({ modelName }) => {
    const model = models[modelName];
    if (!model) {
        return {
            content: [
                {
                    type: "text",
                    text: `Model '${modelName}' not found. Use list-models to see available models.`,
                },
            ],
        };
    }
    // Extract field details
    const fields = Object.entries(model.fields)
        .map(([fieldName, field]) => {
        let typeInfo = field.type.model
            ? `${field.type.model} (model)`
            : field.type.enum
                ? `${field.type.enum} (enum)`
                : field.type;
        let relationshipInfo = "";
        if (field.association) {
            relationshipInfo = `\n    Association: ${field.association.connectionType}`;
            if (field.association.targetNames) {
                relationshipInfo += `\n    Target fields: ${field.association.targetNames.join(", ")}`;
            }
        }
        return `  - ${fieldName}:\n    Type: ${typeInfo}${field.isRequired ? "\n    Required: Yes" : ""}${field.isArray ? "\n    Array: Yes" : ""}${relationshipInfo}`;
    })
        .join("\n\n");
    // Extract auth rules
    const authRules = model.attributes
        .filter((attr) => attr.type === "auth")
        .flatMap((attr) => attr.properties.rules.map((rule) => {
        return `  - Provider: ${rule.provider}\n    Allow: ${rule.allow}\n    Operations: ${rule.operations.join(", ")}`;
    }))
        .join("\n\n");
    return {
        content: [
            {
                type: "text",
                text: `Model: ${modelName}\n\nFields:\n${fields}\n\nAuthorization Rules:\n${authRules}`,
            },
        ],
    };
});
// Tool: Execute a custom GraphQL query
server.tool("run-graphql", "Execute a custom GraphQL query or mutation", {
    query: z.string().describe("GraphQL query or mutation to execute"),
    variables: z
        .string()
        .optional()
        .describe("JSON string of variables for the query"),
}, async ({ query, variables }) => {
    try {
        // Parse variables if provided
        let variablesObj = {};
        if (variables) {
            try {
                variablesObj = JSON.parse(variables);
            }
            catch (e) {
                return {
                    content: [
                        {
                            type: "text",
                            text: `Invalid JSON variables: ${e instanceof Error ? e.message : String(e)}`,
                        },
                    ],
                };
            }
        }
        // Even if not authenticated, we'll now try the request anyway
        // as the automatic re-login will handle authentication if needed
        const result = await executeGraphQLQuery(query, variablesObj);
        return {
            content: [
                {
                    type: "text",
                    text: `Query Result:\n\n${JSON.stringify(result, null, 2)}`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error executing GraphQL query: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
        };
    }
});
// Tool: Get relationship details
server.tool("get-relationships", "Get relationships for a specific model", {
    modelName: z
        .string()
        .describe("Name of the model to get relationships for"),
}, async ({ modelName }) => {
    const model = models[modelName];
    if (!model) {
        return {
            content: [
                {
                    type: "text",
                    text: `Model '${modelName}' not found. Use list-models to see available models.`,
                },
            ],
        };
    }
    // Extract relationships from model
    const relationships = Object.entries(model.fields)
        .filter(([_, field]) => field.association)
        .map(([fieldName, field]) => {
        const association = field.association;
        return {
            fieldName,
            type: field.type.model,
            relationshipType: association.connectionType,
            associatedWith: association.associatedWith?.join(", ") || "N/A",
            targetNames: association.targetNames?.join(", ") || "N/A",
        };
    });
    if (relationships.length === 0) {
        return {
            content: [
                {
                    type: "text",
                    text: `No relationships found for model: ${modelName}`,
                },
            ],
        };
    }
    const relationshipText = relationships
        .map((rel) => {
        return `Field: ${rel.fieldName}\nType: ${rel.type}\nRelationship: ${rel.relationshipType}\nAssociated With: ${rel.associatedWith}\nTarget Names: ${rel.targetNames}`;
    })
        .join("\n\n");
    return {
        content: [
            {
                type: "text",
                text: `Relationships for ${modelName}:\n\n${relationshipText}`,
            },
        ],
    };
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Amplify Data API MCP Server running on stdio");
    // Attempt automatic login if credentials are provided
    if (isAuthInitialized && username && password) {
        try {
            console.error(`Attempting automatic login for user: ${username}`);
            const user = await Auth.signIn(username, password);
            currentUser = user;
            // Get the current session to extract tokens
            const session = await Auth.currentSession();
            idToken = session.getIdToken().getJwtToken();
            // Store credentials for potential re-login
            storedUsername = username;
            storedPassword = password;
            console.error("Automatic login successful");
        }
        catch (error) {
            console.error(`Automatic login failed: ${error instanceof Error ? error.message : String(error)}`);
            console.error("You can still use the login tool to authenticate manually");
        }
    }
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
