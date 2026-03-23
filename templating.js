// templating.js - Handlebar replacements and template parsing
import { DEBUG } from "./utils.js";

const MODULE_NAME = "silly-sim-tracker";

// Module-level variables to store template data
let currentTemplatePosition = "BOTTOM";
let compiledCardTemplates = {};  // Map of position -> compiled template
let availableTemplatePositions = ["BOTTOM"];  // Array of available positions
let currentTemplateStyles = "";  // Extracted template styles from TEMPLATE_STYLE markers

// Extract template styles from TEMPLATE_STYLE markers
const extractTemplateStyles = (templateHtml) => {
  if (!templateHtml) return "";
  
  const styleStartMarker = "<!-- TEMPLATE_STYLE_START -->";
  const styleEndMarker = "<!-- TEMPLATE_STYLE_END -->";
  
  const styleStartIndex = templateHtml.indexOf(styleStartMarker);
  const styleEndIndex = templateHtml.indexOf(styleEndMarker);
  
  if (styleStartIndex !== -1 && styleEndIndex !== -1 && styleEndIndex > styleStartIndex) {
    const stylesContent = templateHtml.substring(styleStartIndex + styleStartMarker.length, styleEndIndex).trim();
    DEBUG && console.log(`[SST] [${MODULE_NAME}] Extracted template styles: ${stylesContent.length} characters`);
    return stylesContent;
  }
  
  return "";
};

// New function to extract multiple template sections based on POSITION comments
// Supports two formats:
// 1. Single section: POSITION -> CARD_TEMPLATE_START -> content -> CARD_TEMPLATE_END
// 2. Multi-section: Each POSITION has its own START/END markers
const extractTemplateSections = (templateHtml) => {
  if (!templateHtml) return { "BOTTOM": templateHtml };
  
  // First, extract template styles if present
  currentTemplateStyles = extractTemplateStyles(templateHtml);
  
  const sections = {};
  const positionRegex = /<!--\s*POSITION\s*:\s*(.*?)\s*-->/gi;
  const startMarker = "<!-- CARD_TEMPLATE_START -->";
  const endMarker = "<!-- CARD_TEMPLATE_END -->";
  
  // Find all POSITION comments
  const matches = [...templateHtml.matchAll(positionRegex)];
  
  if (matches.length === 0) {
    // No POSITION comments found - treat entire template as BOTTOM
    return { "BOTTOM": templateHtml };
  }
  
  // Check if this is a multi-section template (each POSITION has its own START/END)
  // or a single-section template (one START/END for all content)
  const hasMultipleStartMarkers = (templateHtml.match(/<!--\s*CARD_TEMPLATE_START\s*-->/gi) || []).length > 1;
  
  // Process each POSITION comment
  matches.forEach((match, index) => {
    const position = match[1].trim().toUpperCase();
    const positionEndIndex = match.index + match[0].length;
    
    let sectionContent = "";
    
    if (hasMultipleStartMarkers) {
      // Multi-section format: Each POSITION has its own START/END markers
      // Look for START marker after this POSITION
      const startIndex = templateHtml.indexOf(startMarker, positionEndIndex);
      if (startIndex !== -1) {
        // Look for END marker after START
        const contentStart = startIndex + startMarker.length;
        const endIndex = templateHtml.indexOf(endMarker, contentStart);
        
        if (endIndex !== -1) {
          sectionContent = templateHtml.substring(contentStart, endIndex).trim();
        } else {
          // No END marker found, use until next POSITION or EOF
          const nextMatch = matches[index + 1];
          const sectionEnd = nextMatch ? nextMatch.index : templateHtml.length;
          sectionContent = templateHtml.substring(contentStart, sectionEnd).trim();
        }
      }
    } else {
      // Single-section format: One START/END for all content
      // Find the end of this section (next POSITION comment or EOF)
      const nextMatch = matches[index + 1];
      const sectionEndIndex = nextMatch ? nextMatch.index : templateHtml.length;
      
      // Check if there's a START marker in this section
      const sectionText = templateHtml.substring(positionEndIndex, sectionEndIndex);
      const startIndex = sectionText.indexOf(startMarker);
      
      if (startIndex !== -1) {
        // Has START marker, look for END marker
        const contentStart = startIndex + startMarker.length;
        const endIndex = sectionText.indexOf(endMarker, contentStart);
        
        if (endIndex !== -1) {
          sectionContent = sectionText.substring(contentStart, endIndex).trim();
        } else {
          sectionContent = sectionText.substring(contentStart).trim();
        }
      } else {
        // No START marker, use the whole section (fallback for old format)
        sectionContent = sectionText.trim();
      }
    }
    
    if (sectionContent) {
      if (sections[position]) {
        // If section already exists, append to it
        sections[position] += '\n' + sectionContent;
      } else {
        sections[position] = sectionContent;
      }
    }
  });
  
  // If no sections were extracted, fall back to treating entire template as BOTTOM
  if (Object.keys(sections).length === 0) {
    return { "BOTTOM": templateHtml };
  }
  
  DEBUG && console.log(`[SST] [${MODULE_NAME}] Extracted template sections:`, Object.keys(sections));
  return sections;
};

// Helper function to get wrapper template with position-specific ID
const getWrapperTemplate = (position) => 
  `<div id="silly-sim-tracker-container-${position.toLowerCase()}" class="silly-sim-tracker-container" data-position="${position}" style="width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:block !important;visibility:visible !important;">{{{cardsHtml}}}</div>`;

// Helper function to compile template sections for multiple positions
const compileTemplateSections = (cardTemplate, sourceName) => {
  // Extract sections based on POSITION comments
  const sections = extractTemplateSections(cardTemplate);
  
  // Compile each section
  compiledCardTemplates = {};
  compiledWrapperTemplates = {};
  availableTemplatePositions = [];
  
  Object.keys(sections).forEach(position => {
    try {
      compiledCardTemplates[position] = Handlebars.compile(sections[position]);
      compiledWrapperTemplates[position] = Handlebars.compile(getWrapperTemplate(position));
      availableTemplatePositions.push(position);
      DEBUG && console.log(`[SST] [${MODULE_NAME}] Compiled template section for position: ${position} from ${sourceName}`);
    } catch (error) {
      console.error(`[SST] [${MODULE_NAME}] ╔══════════════════════════════════════════════════════════╗`);
      console.error(`[SST] [${MODULE_NAME}] ║  TEMPLATE COMPILATION ERROR`);
      console.error(`[SST] [${MODULE_NAME}] ╠══════════════════════════════════════════════════════════╣`);
      console.error(`[SST] [${MODULE_NAME}] ║  Source: ${sourceName}`);
      console.error(`[SST] [${MODULE_NAME}] ║  Position: ${position}`);
      console.error(`[SST] [${MODULE_NAME}] ║  Error: ${error.message}`);
      
      // Try to extract line number from Handlebars error message
      const lineMatch = error.message.match(/line\s+(\d+)/i);
      if (lineMatch) {
        const errorLine = parseInt(lineMatch[1], 10);
        console.error(`[SST] [${MODULE_NAME}] ║  Line: ${errorLine}`);
        
        // Show context around the error
        const lines = sections[position].split('\n');
        const startLine = Math.max(0, errorLine - 3);
        const endLine = Math.min(lines.length, errorLine + 2);
        console.error(`[SST] [${MODULE_NAME}] ╠══════════════════════════════════════════════════════════╣`);
        console.error(`[SST] [${MODULE_NAME}] ║  Code Context:`);
        for (let i = startLine; i < endLine; i++) {
          const lineNum = i + 1;
          const prefix = lineNum === errorLine ? '>>> ' : '    ';
          const lineContent = lines[i].substring(0, 70).replace(/\s+/g, ' ');
          console.error(`[SST] [${MODULE_NAME}] ║${prefix}${lineNum.toString().padStart(3)}: ${lineContent}`);
        }
      }
      
      console.error(`[SST] [${MODULE_NAME}] ╚══════════════════════════════════════════════════════════╝`);
      
      // Show a toast notification with the error
      toastr.error(
        `Template error in ${sourceName} [${position}]: ${error.message}`,
        "Template Compilation Failed"
      );
    }
  });
  
  // Set the primary position for backward compatibility
  if (availableTemplatePositions.length > 0) {
    currentTemplatePosition = availableTemplatePositions[0];
    DEBUG && console.log(`[SST] [${MODULE_NAME}] Primary template position set to: ${currentTemplatePosition}`);
  }
  
  // Also set the legacy single template for backward compatibility
  if (compiledCardTemplates[currentTemplatePosition]) {
    compiledCardTemplate = compiledCardTemplates[currentTemplatePosition];
    compiledWrapperTemplate = compiledWrapperTemplates[currentTemplatePosition];
  }
  
  return compiledCardTemplates;
};

const unescapeHtml = (safe) => {
  if (typeof safe !== "string") return safe;
  return safe
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
};

// --- TEMPLATES ---
// Default wrapper template - will be replaced by position-specific versions
const wrapperTemplate = `<div id="silly-sim-tracker-container" style="width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:block !important;visibility:visible !important;">{{{cardsHtml}}}</div>`;
let compiledWrapperTemplate = Handlebars.compile(wrapperTemplate);
let compiledCardTemplate = null;

// Store compiled wrapper templates per position
let compiledWrapperTemplates = {};

// Register Handlebars helpers for template logic
Handlebars.registerHelper("eq", function (a, b) {
  return a === b;
});

Handlebars.registerHelper("neq", function (a, b) {
  return a != b;
});

Handlebars.registerHelper("gt", function (a, b) {
  return a > b;
});

Handlebars.registerHelper("and", function (a, b) {
  return a && b;
});

Handlebars.registerHelper("or", function (a, b) {
  return a || b;
});

// Check if string contains substring
Handlebars.registerHelper("contains", function (str, substr) {
  if (typeof str !== "string" || typeof substr !== "string") {
    return false;
  }
  return str.includes(substr);
});

Handlebars.registerHelper("divide", function (a, b) {
  if (typeof a !== "number" || typeof b !== "number" || b === 0) {
    return 0;
  }
  return a / b;
});

Handlebars.registerHelper("divideRoundUp", function (a, b) {
  if (typeof a !== "number" || typeof b !== "number" || b === 0) {
    return 0;
  }
  return Math.ceil(a / b);
});

Handlebars.registerHelper(
  "adjustColorBrightness",
  function (hexColor, brightnessPercent) {
    // Remove # if present
    hexColor = hexColor.replace("#", "");

    // Parse hex to RGB
    let r = parseInt(hexColor.substring(0, 2), 16);
    let g = parseInt(hexColor.substring(2, 4), 16);
    let b = parseInt(hexColor.substring(4, 6), 16);

    // Adjust brightness (0-100% where 100% is original, 50% is half brightness, etc.)
    brightnessPercent = Math.max(0, Math.min(100, brightnessPercent)) / 100;

    // Apply brightness adjustment
    r = Math.min(255, Math.max(0, Math.floor(r * brightnessPercent)));
    g = Math.min(255, Math.max(0, Math.floor(g * brightnessPercent)));
    b = Math.min(255, Math.max(0, Math.floor(b * brightnessPercent)));

    // Convert back to hex
    return `#${r.toString(16).padStart(2, "0")}${g
      .toString(16)
      .padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }
);

Handlebars.registerHelper("tabZIndex", function (index) {
  // Calculate z-index for tabs (higher for first tabs)
  // This creates a stacking effect where the first tab is on top
  return 5 - index;
});

Handlebars.registerHelper("tabOffset", function (index) {
  // Calculate vertical offset for tabs to prevent overlapping
  // Each tab is about 60px high, so we offset by 65px to add some spacing
  return index * 65;
});

Handlebars.registerHelper("initials", function (name) {
  // Extract the first letter of the name and capitalize it
  if (!name || name.length === 0) return "?";
  return name.charAt(0).toUpperCase();
});

Handlebars.registerHelper("unless", function (conditional, options) {
  if (!conditional) {
    return options.fn(this);
  } else {
    return options.inverse(this);
  }
});

// Helper to render dynamic stats HTML
Handlebars.registerHelper("dynamicStats", function (dynamicStatsHtml) {
  // Return the pre-generated dynamic stats HTML
  return new Handlebars.SafeString(dynamicStatsHtml || "");
});

// Function to extract template position from HTML
const extractTemplatePosition = (templateHtml) => {
  if (!templateHtml) return "BOTTOM";
  
  const positionRegex = /<!--\s*POSITION\s*:\s*(.*?)\s*-->/i;
  const positionMatch = templateHtml.match(positionRegex);
  return positionMatch ? positionMatch[1].trim().toUpperCase() : "BOTTOM";
};

const get_extension_directory = () => {
  const index_path = new URL(import.meta.url).pathname;
  return index_path.substring(0, index_path.lastIndexOf("/"));
};

async function populateTemplateDropdown(get_settings) {
  DEBUG && console.log(`[SST] [${MODULE_NAME}] Populating template dropdown with parsed friendly names...`);

  const defaultFiles = [
    "dating-card-template.json",
    "dating-card-template-positioned.json",
    "dating-card-template-sidebar.json",
    "dating-card-template-sidebar-left.json",
    "dating-card-template-sidebar-tabs.json",
    "dating-card-template-sidebar-left-tabs.json",
    "dating-card-template-macro.json",
    "dating-card-template-dynamic.json",
    "inline-simple-template.json",
    "combo-sidebar-inline-template.json"
  ];

  const templateOptions = [];

  // Process default templates
  await Promise.all(
    defaultFiles.map(async (filename) => {
      const filePath = `${get_extension_directory()}/tracker-card-templates/${filename}`;
      let friendlyName = filename.replace(".json", ""); // Default to filename as a fallback

      try {
        const content = await $.get(filePath);
        let jsonData;
        
        // Try to parse as JSON first
        try {
          // jQuery may automatically parse JSON responses, so we need to check if it's already an object
          jsonData = typeof content === "string" ? JSON.parse(content) : content;
        } catch (jsonError) {
          // If JSON parsing fails, log the error and skip this template
          console.error(
            `Could not parse JSON for template ${filename}:`,
            jsonError
          );
          // If parsing fails, add it to the list with its filename so it's not missing
          templateOptions.push({ filename, friendlyName: filename.replace(".json", ""), type: "default" });
          return;
        }

        const templateName = jsonData.templateName || null;
        const author = jsonData.templateAuthor || null;

        if (templateName && author) {
          friendlyName = `${templateName} - by ${author}`;
        } else if (templateName) {
          friendlyName = templateName;
        }

        templateOptions.push({ filename, friendlyName, type: "default" });
      } catch (error) {
        console.error(
          `Could not fetch or parse template info for ${filename}:`,
          error
        );
        // If fetching fails, add it to the list with its filename so it's not missing
        templateOptions.push({ filename, friendlyName: filename.replace(".json", ""), type: "default" });
      }
    })
  );

  // Process user presets
  const userPresets = get_settings ? get_settings("userPresets") || [] : [];
  userPresets.forEach((preset, index) => {
    try {
      const templateName = preset.templateName || `User Preset ${index + 1}`;
      const author = preset.templateAuthor || "Unknown";

      const friendlyName = `${templateName} - by ${author} (User Preset)`;
      const filename = `user-preset-${index}`; // Unique identifier for user presets

      templateOptions.push({ 
        filename, 
        friendlyName, 
        type: "user",
        presetData: preset // Store the preset data for later use
      });
    } catch (error) {
      console.error(
        `Could not process user preset ${index}:`,
        error
      );
    }
  });

  // Sort the results alphabetically by friendly name for a clean list
  templateOptions.sort((a, b) => a.friendlyName.localeCompare(b.friendlyName));

  DEBUG && console.log(`[SST] [${MODULE_NAME}] Template options to be added to dropdown:`, templateOptions);

  const $select = $("#templateFile");
  const currentSelection = get_settings ? get_settings("templateFile") : null;

  $select.empty();
  templateOptions.forEach((option) => {
    $select.append(
      $("<option>", {
        value: option.filename,
        text: option.friendlyName,
        "data-type": option.type, // Store type as data attribute
        "data-preset": option.presetData ? JSON.stringify(option.presetData) : undefined // Store preset data as data attribute
      })
    );
  });

  // Restore the user's selection
  $select.val(currentSelection);
  DEBUG && console.log(`[SST] [${MODULE_NAME}] Template dropdown populated with friendly names.`);
}

function handleCustomTemplateUpload(event, set_settings, loadTemplate, refreshAllCards) {
  const file = event.target.files[0];
  if (!file) {
    return; // User cancelled the dialog
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const content = e.target.result;
    DEBUG && console.log(`[SST] [${MODULE_NAME}] Read custom template ${file.name}, size: ${content.length}`);
    set_settings("customTemplateHtml", content);
    toastr.success(`Custom template "${file.name}" loaded and applied!`);

    // Immediately reload the template logic and refresh all cards
    await loadTemplate();
    refreshAllCards();
  };
  reader.readAsText(file);

  event.target.value = "";
}

// Load template from file
const loadTemplate = async (get_settings, set_settings) => {
  if (!get_settings || !set_settings) {
    console.error(`[SST] [${MODULE_NAME}] loadTemplate called without required get_settings and set_settings functions`);
    return {};
  }
  
  const customTemplateHtml = get_settings("customTemplateHtml");

  if (customTemplateHtml && customTemplateHtml.trim() !== "") {
    DEBUG && console.log(`[SST] [${MODULE_NAME}] Loading template from custom HTML stored in settings.`);
    try {
      // Pass the full template content to compileTemplateSections
      // which will handle POSITION comments and CARD_TEMPLATE markers internally
      compileTemplateSections(customTemplateHtml.trim(), "custom HTML");
      DEBUG && console.log(`[SST] [${MODULE_NAME}] Custom HTML template compiled successfully. Positions: ${availableTemplatePositions.join(', ')}`);
      return compiledCardTemplates;
    } catch (error) {
      console.error(`[SST] [${MODULE_NAME}] Error parsing custom HTML template: ${error.message}. Reverting to default file-based template.`);
      toastr.error(
        "The custom HTML template could not be parsed. Check its format.",
        "Template Error"
      );
    }
  }

  const templateFile = get_settings("templateFile");
  if (templateFile) {
    // Check if this is a user preset
    if (templateFile.startsWith("user-preset-")) {
      try {
        // Get the selected option to retrieve the preset data
        const $select = $("#templateFile");
        const $selectedOption = $select.find(`option[value="${templateFile}"]`);
        const presetData = $selectedOption.data("preset");
        
        if (presetData) {
          DEBUG && console.log(`[SST] [${MODULE_NAME}] Loading template from user preset: ${templateFile}`);
          
          // Unescape the HTML template and pass to compileTemplateSections
          // which will handle POSITION comments and CARD_TEMPLATE markers internally
          const unescapedHtmlTemplate = unescapeHtml(presetData.htmlTemplate);
          compileTemplateSections(unescapedHtmlTemplate.trim(), `user preset '${templateFile}'`);
          DEBUG && console.log(`[SST] [${MODULE_NAME}] User preset '${templateFile}' compiled successfully. Positions: ${availableTemplatePositions.join(', ')}`);
          return compiledCardTemplates;
        }
      } catch (error) {
        console.error(`[SST] [${MODULE_NAME}] Could not load or parse user preset '${templateFile}'. Using default template.`);
      }
    } else {
      // Handle default templates (JSON files)
      const defaultPath = `${get_extension_directory()}/tracker-card-templates/${templateFile}`;
      try {
        const templateContent = await $.get(defaultPath);
        let jsonData;
        
        // Try to parse as JSON first
        try {
          jsonData = JSON.parse(templateContent);
        } catch (jsonError) {
          throw new Error(`Could not parse JSON for template ${templateFile}: ${jsonError.message}`);
        }
        
        DEBUG && console.log(`[SST] [${MODULE_NAME}] Loading template from default file: ${defaultPath}`);

        // Unescape the HTML template and pass to compileTemplateSections
        // which will handle POSITION comments and CARD_TEMPLATE markers internally
        const unescapedHtmlTemplate = unescapeHtml(jsonData.htmlTemplate);
        compileTemplateSections(unescapedHtmlTemplate.trim(), `default template '${templateFile}'`);
        DEBUG && console.log(`[SST] [${MODULE_NAME}] Default template '${templateFile}' compiled successfully. Positions: ${availableTemplatePositions.join(', ')}`);
        return compiledCardTemplates;
      } catch (error) {
        console.error(`[SST] [${MODULE_NAME}] Could not load or parse default template file '${templateFile}'. Using hardcoded fallback. Error: ${error.message}`);
      }
    }
  }

  DEBUG && console.log(`[SST] [${MODULE_NAME}] Using hardcoded fallback template as a last resort.`);
  const fallbackTemplate = `
    <div style="flex:1 1 100%;min-width:380px;max-width:500px;background:red;border-radius:16px;padding:16px;color:#fff;">
        <b>Template Error</b><br>
        No custom template is loaded and the selected default template could not be found or parsed.
    </div>`;
  
  // Compile fallback as single BOTTOM section
  compileTemplateSections(fallbackTemplate, "fallback");
  return compiledCardTemplates;
};

// Export functions and variables
export {
  wrapperTemplate,
  compiledWrapperTemplate,
  compiledCardTemplate,
  compiledCardTemplates,
  compiledWrapperTemplates,
  availableTemplatePositions,
  getWrapperTemplate,
  extractTemplateSections,
  extractTemplateStyles,
  compileTemplateSections,
  get_extension_directory,
  populateTemplateDropdown,
  handleCustomTemplateUpload,
  loadTemplate,
  extractTemplatePosition,
  currentTemplatePosition,
  currentTemplateStyles,
  unescapeHtml
};
