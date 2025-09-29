// formatUtils.js - Format detection, parsing, and generation utilities
import { get_extension_directory } from "./utils.js";
import { yaml } from "../../../../lib.js";

const MODULE_NAME = "silly-sim-tracker";

// --- FORMAT UTILITIES ---
const log = (message) => console.log(`[SST] [${MODULE_NAME}]`, message);

// Function to detect the format of a tracker block
const detectFormat = (content) => {
  // Trim whitespace
  const trimmedContent = content.trim();
  
  // Try to detect JSON format (starts with { or [)
  if ((trimmedContent.startsWith("{") && trimmedContent.endsWith("}")) || 
      (trimmedContent.startsWith("[") && trimmedContent.endsWith("]"))) {
    return "json";
  }
  
  // If it doesn't start with { or [, it might be YAML
  // We'll assume YAML for non-JSON content for now
  return "yaml";
};

// Function to parse YAML content using SillyTavern's built-in YAML library
const parseYaml = (yamlContent) => {
  try {
    return yaml.parse(yamlContent);
  } catch (error) {
    log(`Error parsing YAML content: ${error.message}`);
    throw error;
  }
};

// Function to convert JSON to YAML using SillyTavern's built-in YAML library
const convertJsonToYaml = (jsonObject) => {
  try {
    return yaml.stringify(jsonObject);
  } catch (error) {
    log(`Error converting JSON to YAML: ${error.message}`);
    throw error;
  }
};



// Universal parser that can handle both JSON and YAML
const parseTrackerData = (content, format = null) => {
  try {
    // Detect format if not specified
    if (!format) {
      format = detectFormat(content);
    }
    
    if (format === "json") {
      return JSON.parse(content);
    } else if (format === "yaml") {
      return parseYaml(content);
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    log(`Error parsing tracker data: ${error.message}`);
    throw error;
  }
};

// Function to generate tracker block in the specified format
const generateTrackerBlock = (data, format, identifier) => {
  try {
    if (format === "json") {
      return `\`\`\`${identifier}\n${JSON.stringify(data, null, 2)}\n\`\`\``;
    } else if (format === "yaml") {
      const yamlContent = convertJsonToYaml(data);
      return `\`\`\`${identifier}\n${yamlContent}\`\`\``;
    } else {
      throw new Error(`Unsupported format: ${format}`);
    }
  } catch (error) {
    log(`Error generating tracker block: ${error.message}`);
    throw error;
  }
};

// Function to convert between formats
const convertTrackerFormat = (content, targetFormat, identifier) => {
  try {
    // Parse the content regardless of its current format
    const data = parseTrackerData(content);
    
    // Generate in the target format
    return generateTrackerBlock(data, targetFormat, identifier);
  } catch (error) {
    log(`Error converting tracker format: ${error.message}`);
    throw error;
  }
};

// Export functions
export {
  detectFormat,
  parseYaml,
  convertJsonToYaml,
  parseTrackerData,
  generateTrackerBlock,
  convertTrackerFormat
};