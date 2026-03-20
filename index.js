import { getContext, extension_settings } from "../../../extensions.js";
import {
  saveSettingsDebounced,
  messageFormatting,
  Generate,
} from "../../../../script.js";
import { MacrosParser } from "../../../macros.js";
import { MacroRegistry, MacroCategory, MacroValueType } from "../../../macros/engine/MacroRegistry.js"
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";

// Import from our new modules
import {
  renderTracker,
  renderTrackerWithoutSim,
  refreshAllCards,
  updateLeftSidebar,
  updateRightSidebar,
  removeGlobalSidebars,
  pendingLeftSidebarContent,
  pendingRightSidebarContent,
  mesTextsWithPreparingText,
  setGenerationInProgress,
  getGenerationInProgress,
  setGenerationType,
  getGenerationType,
  clearGenerationType,
  messageDataCache,
  CONTAINER_ID
} from "./renderer.js";

import {
  compiledWrapperTemplate,
  compiledCardTemplate,
  populateTemplateDropdown,
  handleCustomTemplateUpload,
  loadTemplate,
  extractTemplatePosition,
  currentTemplatePosition
} from "./templating.js";

import {
  get_settings,
  set_settings,
  initialize_settings,
  initialize_settings_listeners,
  load_settings_html_manually,
  refresh_settings_ui,
  defaultSimFields,
  handlePresetExport,
  handlePresetImport,
  showManagePresetsModal
} from "./settingsHandler.js";

import {
  log,
  DEBUG,
  sanitizeFieldKey,
  darkenColor,
  getReactionEmoji,
  getInactiveReasonEmoji,
  updateLastSimStatsOnRegenerateOrSwipe,
  filterSimBlocksInPrompt,
  migrateAllSimData
} from "./utils.js";

import {
  parseTrackerData,
  generateTrackerBlock
} from "./formatUtils.js";

import {
  initMetadata,
  getMetadata,
  saveMetadata,
  getCardData,
  getAllCards,
  getCardNames,
  getWorldData,
  migrateChatToMetadata,
  isMetadataInitialized
} from "./storage.js";

const MODULE_NAME = "silly-sim-tracker";

let lastSimJsonString = "";
// Keep track of when we're expecting code blocks to be generated
let isGeneratingCodeBlocks = false;

// --- INTERCEPTOR ---
globalThis.simTrackerGenInterceptor = async function (
  chat,
  contextSize,
  abort,
  type
) {
  log(`simTrackerGenInterceptor called with type: ${type}`);

  // Note: isGenerationInProgress is managed within the renderer module
  setGenerationType(type);

  // Handle regenerate and swipe conditions to reset last_sim_stats macro
  if (type === "regenerate" || type === "swipe") {
    log(`Handling ${type} condition - updating last_sim_stats macro`);
    // For regenerate/swipe operations, pass the ID of the last message in chat
    // This helps find sim data from the message before the one being regenerated/swiped
    const lastMesId =
      chat && Array.isArray(chat) && chat.length > 0 ? chat.length - 1 : null;
    const updatedStats = updateLastSimStatsOnRegenerateOrSwipe(lastMesId, get_settings);
    if (updatedStats) {
      lastSimJsonString = updatedStats;
    }
  }

  // Filter out sim blocks from messages beyond the last 3
  filterSimBlocksInPrompt(chat, get_settings);

  return { chat, contextSize, abort };
};

// --- ENTRY POINT ---
jQuery(async () => {
  try {
    log(`Initializing extension: ${MODULE_NAME}`);
    await initialize_settings();
    await load_settings_html_manually();
    await populateTemplateDropdown(get_settings);
    
    // Create wrapper functions that pass the required dependencies
    const wrappedLoadTemplate = () => loadTemplate(get_settings, set_settings);
    const wrappedRefreshAllCards = () => refreshAllCards(get_settings, CONTAINER_ID, 
      (mesId) => renderTrackerWithoutSim(mesId, get_settings, compiledWrapperTemplate, compiledCardTemplate, getReactionEmoji, darkenColor, lastSimJsonString));
    const wrappedMigrateAllSimData = () => migrateAllSimData(get_settings);
    const wrappedHandleCustomTemplateUpload = (event) => handleCustomTemplateUpload(event, set_settings, wrappedLoadTemplate, wrappedRefreshAllCards);
    const wrappedHandlePresetExport = () => handlePresetExport(wrappedLoadTemplate, wrappedRefreshAllCards);
    const wrappedHandlePresetImport = (event) => handlePresetImport(event, wrappedLoadTemplate, wrappedRefreshAllCards);
    const wrappedShowManagePresetsModal = () => showManagePresetsModal(wrappedLoadTemplate, wrappedRefreshAllCards);
    
    initialize_settings_listeners(wrappedLoadTemplate, wrappedRefreshAllCards, wrappedMigrateAllSimData, wrappedHandleCustomTemplateUpload, wrappedHandlePresetExport, wrappedHandlePresetImport, wrappedShowManagePresetsModal);
    log("Settings panel listeners initialized.");
    
    // Refresh the settings UI to populate form elements with existing settings
    refresh_settings_ui();
    log("Settings UI refreshed with existing values.");
    
    await wrappedLoadTemplate();

    // Initialize metadata storage
    initMetadata();
    log("Metadata storage initialized.");

    // Set up MutationObserver to hide sim code blocks as they stream in
    log("Setting up MutationObserver for in-flight sim block hiding...");
    const observer = new MutationObserver((mutations) => {
      // Only process if the extension is enabled, hiding is turned on, and generation is in progress
      if (
        !get_settings("isEnabled") ||
        !get_settings("hideSimBlocks") ||
        !getGenerationInProgress()
      )
        return;

      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          // Check if the added node is a pre element or contains pre elements
          if (node.nodeType === Node.ELEMENT_NODE) {
            const preElements =
              node.tagName === "PRE" ? [node] : node.querySelectorAll("pre");
            preElements.forEach((pre) => {
              // Check if this pre element is within a mes_text div and contains sim data
              if (pre.closest(".mes_text")) {
                // Check if this is a sim code block
                const codeElement = pre.querySelector("code");
                if (codeElement) {
                  const identifier = get_settings("codeBlockIdentifier");
                  const classList = codeElement.classList;
                  // Check if any class matches our identifier (like language-sim)
                  const isSimBlock =
                    Array.from(classList).some((cls) =>
                      cls.includes(identifier)
                    ) || codeElement.textContent.trim().startsWith(identifier);

                  if (isSimBlock) {
                    log(`Hiding in-flight code block in mes_text`);
                    pre.style.display = "none";

                    // Add "Preparing new tracker cards..." text with pulsing animation
                    const mesText = pre.closest(".mes_text");
                    if (mesText && !mesTextsWithPreparingText.has(mesText)) {
                      // Mark this mesText as having preparing text
                      mesTextsWithPreparingText.add(mesText);

                      const preparingText = document.createElement("div");
                      preparingText.className = "sst-preparing-text";
                      preparingText.textContent =
                        "Preparing new tracker cards...";
                      preparingText.style.cssText = `
                                            color: #4a3a9d; /* Darker blue */
                                            font-style: italic;
                                            margin: 10px 0;
                                            animation: sst-pulse 1.5s infinite;
                                        `;
                      // Insert after mesText instead of appending to it
                      mesText.parentNode.insertBefore(
                        preparingText,
                        mesText.nextSibling
                      );

                      // Add the pulse animation to the document if not already present
                      if (!document.getElementById("sst-pulse-animation")) {
                        const style = document.createElement("style");
                        style.id = "sst-pulse-animation";
                        style.textContent = `
                                                @keyframes sst-pulse {
                                                    0% { opacity: 0.5; }
                                                    50% { opacity: 1; }
                                                    100% { opacity: 0.5; }
                                                }
                                            `;
                        document.head.appendChild(style);
                      }
                    }
                  }
                }
              }
            });
          }
        });
      });
    });

    // Start observing for changes in the document
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    log("MutationObserver set up for in-flight sim block hiding.");

    log("Registering macros...");
    MacrosParser.registerMacro("sim_tracker", () => {
      if (!get_settings("isEnabled")) return "";
      log("Processed {{sim_tracker}} macro.");
      return get_settings("datingSimPrompt");
    });

    MacrosParser.registerMacro("last_sim_stats", () => {
      if (!get_settings("isEnabled")) return "";
      log("Processed {{last_sim_stats}} macro.");
      return lastSimJsonString || "{}";
    });

    // Register the slash command for converting sim data formats
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: "sst-convert",
        callback: (args) => {
          // Check if a format parameter was provided
          const targetFormat = args && args.length > 0 ? args[0].toLowerCase() : null;
          
          // Validate format parameter
          if (targetFormat && targetFormat !== "json" && targetFormat !== "yaml" && targetFormat !== "auto") {
            return "Invalid format specified. Use 'json', 'yaml', or 'auto'.";
          }
          
          let message = "This will convert all sim data in the current chat to the new format.";
          if (targetFormat) {
            message += ` All blocks will be converted to ${targetFormat.toUpperCase()} format.`;
          }
          message += " Are you sure?";
          
          if (confirm(message)) {
            // If a target format was specified, update the user's setting
            if (targetFormat) {
              set_settings("trackerFormat", targetFormat);
            }
            wrappedMigrateAllSimData();
            return "Converting sim data formats... Check notifications for results.";
          }
          return "Conversion cancelled.";
        },
        returns: "status message",
        unnamedArgumentList: [
          {
            name: "format",
            type: "string",
            description: "Target format (json, yaml, or auto). If not specified, uses current setting.",
            optional: true,
          },
        ],
        helpString: `
                <div>
                    Converts all sim data in the current chat from the old format to the new format.
                    Optionally converts all blocks to a specific format.
                </div>
                <div>
                    <strong>Examples:</strong>
                    <ul>
                        <li>
                            <pre><code class="language-stscript">/sst-convert</code></pre>
                            Converts all sim data in the current chat to the new format using current settings
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-convert json</code></pre>
                            Converts all sim data to JSON format
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-convert yaml</code></pre>
                            Converts all sim data to YAML format
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-convert auto</code></pre>
                            Sets the tracker format to auto-detect and migrates data
                        </li>
                    </ul>
                </div>
            `,
      })
    );

    MacrosParser.registerMacro("sim_format", () => {
      if (!get_settings("isEnabled")) return "";
      const fields = get_settings("customFields") || [];
      const userFormat = get_settings("trackerFormat") || "auto";
      // For generation, default to JSON when auto is selected
      const format = userFormat === "auto" ? "json" : userFormat;
      log("Processed {{sim_format}} macro.");

      if (format === "yaml") {
        // Generate YAML example structure with the new format
        let exampleYaml = "worldData:\n";
        exampleYaml += "  current_date: \"[CURRENT_STORY_DATE]\"  # YYYY-MM-DD\n";
        exampleYaml += "  current_time: \"[CURRENT_STORY_TIME]\"  # 24-hour time (e.g., 21:34, 10:21)\n";
        exampleYaml += "cards:\n";
        exampleYaml += "  - name: \"[CHARACTER_NAME]\"\n";

        // Add each custom field as a commented key-value pair
        fields.forEach((field) => {
          const sanitizedKey = sanitizeFieldKey(field.key);
          exampleYaml += `    ${sanitizedKey}: [${sanitizedKey.toUpperCase()}_VALUE]  # ${
            field.description
          }\n`;
        });

        exampleYaml += "  # Add additional character objects here as needed\n";

        // Wrap in the code block with the identifier
        const identifier = get_settings("codeBlockIdentifier") || "sim";
        return `\`\`\`${identifier}
${exampleYaml}\`\`\``;
      } else {
        // Generate JSON example structure with the new format
        let exampleJson = "{\n";
        exampleJson += "  \"worldData\": {\n";
        exampleJson += "    \"current_date\": \"[CURRENT_STORY_DATE]\", // YYYY-MM-DD\n";
        exampleJson += "    \"current_time\": \"[CURRENT_STORY_TIME]\" // 24-hour time (e.g., 21:34, 10:21)\n";
        exampleJson += "  },\n";
        exampleJson += "  \"cards\": [\n";
        exampleJson += "    {\n";
        exampleJson += "      \"name\": \"[CHARACTER_NAME]\",\n";

        // Add each custom field as a commented key-value pair
        fields.forEach((field) => {
          const sanitizedKey = sanitizeFieldKey(field.key);
          exampleJson += `      "${sanitizedKey}": [${sanitizedKey.toUpperCase()}_VALUE], // ${
            field.description
          }\n`;
        });

        exampleJson += "    }\n";
        exampleJson += "    // Add additional character objects here as needed\n";
        exampleJson += "  ]\n";
        exampleJson += "}";

        // Wrap in the code block with the identifier
        const identifier = get_settings("codeBlockIdentifier") || "sim";
        return `\`\`\`${identifier}
${exampleJson}
\`\`\``;
      }
    });

    // Register a new macro for positionable tracker replacement
    MacrosParser.registerMacro("sim_tracker_positioned", () => {
      if (!get_settings("isEnabled")) return "";
      log("Processed {{sim_tracker_positioned}} macro.");

      // This macro is used for template positioning, but the position is now defined in the template itself
      // We'll return an empty string as the position is handled during rendering
      return "";
    });

    // Register metadata-based macros for accessing accumulated card data
    MacroRegistry.registerMacro('sim_current', {
      category: MacroCategory.CHARACTER,
      unnamedArgs: [
        {
          name: 'card',
          type: MacroValueType.STRING,
          description: 'Card name',
        },
        {
          name: 'field',
          type: MacroValueType.STRING,
          description: 'Field name (e.g., ap, dp, relationshipStatus). If omitted, returns all card data.',
          optional: true,
        },
      ],
      description: 'Returns the current accumulated value for a specific card field, or all card data if field is omitted.',
      returns: 'The field value as a string, or JSON object of all data.',
      exampleUsage: ['{{sim_current::Alice::ap}}', '{{sim_current::Alice}}', '{{sim_current::Bob::relationshipStatus}}'],
      handler: ({ unnamedArgs: [cardName, fieldName] }) => {
        if (!get_settings("isEnabled")) return "";
        
        if (!cardName) {
          log("sim_current macro requires at least a card name: {{sim_current::card}}");
          return "";
        }
        
        const cardData = getCardData(cardName);
        if (!cardData) {
          return "";
        }
        
        // If field is specified, return just that field
        if (fieldName && cardData[fieldName] !== undefined) {
          const value = cardData[fieldName];
          log(`Processed {{sim_current::${cardName}::${fieldName}}} = ${value}`);
          
          // Return the value as a string
          if (Array.isArray(value)) {
            return value.join(', ');
          }
          return String(value);
        }
        
        // If no field specified, return all card data as formatted text
        log(`Processed {{sim_current::${cardName}}} = all data`);
        
        // Format all data as a readable list
        const dataEntries = Object.entries(cardData)
          .filter(([key]) => key !== 'name') // Skip the name field since it's the header
          .map(([key, value]) => {
            if (Array.isArray(value)) {
              return `${key}: ${value.join(', ')}`;
            }
            return `${key}: ${value}`;
          });
        
        return dataEntries.join('\n');
      },
    });

    MacroRegistry.registerMacro('sim_cards', {
      category: MacroCategory.CHARACTER,
      unnamedArgs: [],
      description: 'Returns a comma-separated list of all tracked card names.',
      returns: 'Comma-separated list of card names.',
      exampleUsage: ['{{sim_cards}}'],
      handler: () => {
        if (!get_settings("isEnabled")) return "";
        
        const names = getCardNames() || [];
        log(`Processed {{sim_cards}} = ${names.join(', ')}`);
        
        return names.join(',');
      },
    });

    MacroRegistry.registerMacro('sim_world', {
      category: MacroCategory.WORLD,
      unnamedArgs: [
        {
          name: 'key',
          optional: true,
          type: MacroValueType.STRING,
          description: 'World data key (e.g., current_date, current_time). If omitted, returns all world data.',
        },
      ],
      description: 'Returns the current accumulated world data value for a specific key, or all world data if key is omitted.',
      returns: 'The world data value as a string, or formatted list of all world data.',
      exampleUsage: ['{{sim_world::current_date}}', '{{sim_world}}', '{{sim_world::current_time}}'],
      handler: ({ unnamedArgs: [key] }) => {
        if (!get_settings("isEnabled")) return "";
        
        const worldData = getWorldData();
        
        // If key is specified, return just that value
        if (key && worldData[key] !== undefined) {
          const value = worldData[key];
          log(`Processed {{sim_world::${key}}} = ${value}`);
          return String(value);
        }
        
        // If no key specified, return all world data as formatted text
        log(`Processed {{sim_world}} = all data`);
        
        const dataEntries = Object.entries(worldData)
          .map(([k, value]) => {
            if (Array.isArray(value)) {
              return `${k}: ${value.join(', ')}`;
            }
            return `${k}: ${value}`;
          });
        
        return dataEntries.join('\n');
      },
    });

    log("Macros registered successfully.");

    // Register the slash command for adding sim data to messages
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: "sst-add",
        callback: async () => {
          if (!get_settings("isEnabled")) {
            return "Silly Sim Tracker is not enabled.";
          }

          try {
            const context = getContext();
            if (!context || !context.chat || context.chat.length === 0) {
              return "No chat history found.";
            }

            // Get the last character message
            let lastCharMessageIndex = -1;
            for (let i = context.chat.length - 1; i >= 0; i--) {
              if (!context.chat[i].is_user && !context.chat[i].is_system) {
                lastCharMessageIndex = i;
                break;
              }
            }

            if (lastCharMessageIndex === -1) {
              return "No character message found in chat history.";
            }

            const lastCharMessage = context.chat[lastCharMessageIndex];

            // Check if the message already contains a sim block
            const identifier = get_settings("codeBlockIdentifier");
            const simRegex = new RegExp(
              "```" + identifier + "[\\s\\S]*?```",
              "m"
            );
            if (simRegex.test(lastCharMessage.mes)) {
              return "Last character message already contains a sim block.";
            }

            // Append the sim block to the message in the user's preferred format
            const userFormat = get_settings("trackerFormat") || "auto";
            // For generation, default to JSON when auto is selected
            const format = userFormat === "auto" ? "json" : userFormat;
            let simBlock;
            
            if (format === "yaml") {
              // Create a basic YAML structure
              simBlock = `
\`\`\`${identifier}
worldData:
  current_date: ""
  current_time: ""
cards:
  - name: ""
    ap: 0
    dp: 0
    tp: 0
    cp: 0
\`\`\``;
            } else {
              // Create a basic JSON structure
              simBlock = `
\`\`\`${identifier}
{
  "worldData": {
    "current_date": "",
    "current_time": ""
  },
  "cards": [
    {
      "name": "",
      "ap": 0,
      "dp": 0,
      "tp": 0,
      "cp": 0
    }
  ]
}
\`\`\``;
            }
            
            lastCharMessage.mes += simBlock;

            // Update the message in the UI
            const messageElement = document.querySelector(
              `div[mesid="${lastCharMessageIndex}"] .mes_text`
            );
            if (messageElement) {
              messageElement.innerHTML = messageFormatting(
                lastCharMessage.mes,
                lastCharMessage.name,
                lastCharMessage.is_system,
                lastCharMessage.is_user,
                lastCharMessageIndex
              );
            }

            // Use the proper Generate function to continue generation
            await Generate("continue", {});

            return "Added sim block to last character message and requested continuation.";
          } catch (error) {
            log(`Error in /sst-add command: ${error.message}`);
            return `Error: ${error.message}`;
          }
        },
        returns: "status message",
        unnamedArgumentList: [],
        helpString: `
                <div>
                    Adds a sim block to the last character message if it doesn't already have one, and requests continuation.
                </div>
                <div>
                    <strong>Example:</strong>
                    <ul>
                        <li>
                            <pre><code class="language-stscript">/sst-add</code></pre>
                            Adds a sim block to the last character message and continues generation
                        </li>
                    </ul>
                </div>
            `,
      })
    );

    // Register slash command for metadata migration
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: "sst-init-metadata",
        callback: async (args, value) => {
          if (!get_settings("isEnabled")) {
            return "Silly Sim Tracker is not enabled.";
          }

          const context = getContext();
          if (!context || !context.chat || context.chat.length === 0) {
            return "No chat history found to migrate.";
          }

          // Use provided identifier, or fall back to settings, or default to "sim"
          const identifier = value || get_settings("codeBlockIdentifier") || "sim";

          if (confirm(`This will RESET the metadata storage and rescan all messages for code blocks with identifier "${identifier}". Any existing accumulated card data will be wiped and rebuilt from chat history. Continue?`)) {
            try {
              // Always clear the metadata first
              const storage = getMetadata();
              storage.cards = {};
              storage.worldData = {};
              saveMetadata();
              log("Metadata storage reset.");
              
              const count = await migrateChatToMetadata(identifier);
              return `Migration complete! Processed ${count} sim data blocks with identifier "${identifier}". Metadata storage has been reset and populated.`;
            } catch (error) {
              log(`Error in /sst-init-metadata: ${error.message}`);
              return `Error during migration: ${error.message}`;
            }
          }
          return "Migration cancelled.";
        },
        returns: "status message",
        unnamedArgumentList: [
          {
            name: "identifier",
            type: "string",
            description: "Code block identifier to search for (e.g., 'sim', 'tracker'). Uses settings value if not specified.",
            optional: true,
          }
        ],
        helpString: `
                <div>
                    Resets metadata storage and rescans all messages to populate it with accumulated card data.
                </div>
                <div>
                    <strong>Examples:</strong>
                    <ul>
                        <li>
                            <pre><code class="language-stscript">/sst-init-metadata</code></pre>
                            Resets and migrates using the code block identifier from settings
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-init-metadata tracker</code></pre>
                            Resets and migrates using "tracker" as the code block identifier
                        </li>
                    </ul>
                </div>
            `,
      })
    );

    // Register slash command for manually setting card data
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: "sst-set-card",
        callback: async (args) => {
          if (!get_settings("isEnabled")) {
            return "Silly Sim Tracker is not enabled.";
          }

          const cardName = args.card;
          const fieldName = args.field;
          let value = args.value;

          if (!cardName || !fieldName) {
            return "Usage: /sst-set-card card=<name> field=<field> [value=<value>]";
          }

          // Check if value is blank/null/undefined - if so, remove the field
          const isRemovingField = value === undefined || value === null || value === '';

          if (!isRemovingField) {
            // Try to parse value as number if it looks like one
            if (value && !isNaN(value) && !isNaN(parseFloat(value))) {
              value = parseFloat(value);
            }
          }

          try {
            // Import storage functions dynamically
            const { updateCardData, getCardData, getMetadata, saveMetadata } = await import("./storage.js");
            
            if (isRemovingField) {
              // Remove the field
              const cardData = getCardData(cardName);
              if (cardData && cardData[fieldName] !== undefined) {
                // Get the storage object and delete from the internal data structure
                const storage = getMetadata();
                if (storage.cards[cardName] && storage.cards[cardName].data) {
                  delete storage.cards[cardName].data[fieldName];
                  saveMetadata();
                  log(`Removed field ${cardName}.${fieldName}`);
                  return `Removed ${cardName}.${fieldName}`;
                }
              }
              return `Field ${cardName}.${fieldName} not found.`;
            } else {
              // Set the field value
              const existingData = getCardData(cardName) || {};
              existingData[fieldName] = value;
              
              // Update the card data
              updateCardData(cardName, existingData);
              
              log(`Manually set ${cardName}.${fieldName} = ${value}`);
              return `Set ${cardName}.${fieldName} = ${value}`;
            }
          } catch (error) {
            log(`Error in /sst-set-card: ${error.message}`);
            return `Error: ${error.message}`;
          }
        },
        returns: "status message",
        namedArgumentList: [
          {
            name: "card",
            type: "string",
            description: "Card name",
          },
          {
            name: "field",
            type: "string",
            description: "Field name to set",
          },
          {
            name: "value",
            type: "string",
            description: "Value to set (will be parsed as number if numeric). Leave blank to remove the field.",
            isRequired: false,
          },
        ],
        helpString: `
                <div>
                    Manually sets or removes a card field value in the metadata storage.
                </div>
                <div>
                    <strong>Examples:</strong>
                    <ul>
                        <li>
                            <pre><code class="language-stscript">/sst-set-card card=Alice field=ap value=50</code></pre>
                            Sets Alice's AP to 50
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-set-card card=Bob field=relationshipStatus value=Friendly</code></pre>
                            Sets Bob's relationship status
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-set-card card=Alice field=tempBuff</code></pre>
                            Removes the tempBuff field from Alice
                        </li>
                    </ul>
                </div>
            `,
      })
    );

    // Register slash command for removing a card
    SlashCommandParser.addCommandObject(
      SlashCommand.fromProps({
        name: "sst-remove-card",
        callback: async (args, value) => {
          if (!get_settings("isEnabled")) {
            return "Silly Sim Tracker is not enabled.";
          }

          const cardName = value || args.card;

          if (!cardName) {
            return "Usage: /sst-remove-card <card_name> or /sst-remove-card card=<name>";
          }

          if (confirm(`Are you sure you want to remove all data for card "${cardName}"? This cannot be undone.`)) {
            try {
              // Import storage functions dynamically
              const { getMetadata, saveMetadata, getCardData } = await import("./storage.js");
              
              // Check if card exists
              const cardData = getCardData(cardName);
              if (!cardData) {
                return `Card "${cardName}" not found in metadata.`;
              }
              
              // Remove the card
              const storage = getMetadata();
              delete storage.cards[cardName];
              saveMetadata();
              
              log(`Removed card ${cardName} from metadata`);
              return `Card "${cardName}" has been removed from metadata storage.`;
            } catch (error) {
              log(`Error in /sst-remove-card: ${error.message}`);
              return `Error: ${error.message}`;
            }
          }
          return "Removal cancelled.";
        },
        returns: "status message",
        unnamedArgumentList: [
          {
            name: "card",
            type: "string",
            description: "Card name to remove",
            optional: true,
          }
        ],
        namedArgumentList: [
          {
            name: "card",
            type: "string",
            description: "Card name to remove",
          }
        ],
        helpString: `
                <div>
                    Removes a card and all its data from the metadata storage.
                </div>
                <div>
                    <strong>Examples:</strong>
                    <ul>
                        <li>
                            <pre><code class="language-stscript">/sst-remove-card Alice</code></pre>
                            Removes Alice from metadata
                        </li>
                        <li>
                            <pre><code class="language-stscript">/sst-remove-card card=Bob</code></pre>
                            Removes Bob from metadata
                        </li>
                    </ul>
                </div>
            `,
      })
    );

    const context = getContext();
    const { eventSource, event_types } = context;

    // Set generation in progress flag when generation starts
    eventSource.on(event_types.GENERATION_STARTED, () => {
      setGenerationInProgress(true);
    });

    // Also set generation in progress flag for after commands event
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
      setGenerationInProgress(true);
    });

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, (mesId) => {
      // Clear generation in progress flag when message is rendered
      if (getGenerationType() == 'swipe') {
        clearGenerationType();
        return;
      }
      let withSim = getGenerationInProgress();
      setGenerationInProgress(false);
      renderTracker(mesId, get_settings, compiledWrapperTemplate, compiledCardTemplate, getReactionEmoji, darkenColor, lastSimJsonString, withSim);
    });
    
    eventSource.on(event_types.CHAT_CHANGED, () => {
      // Clear cache on chat change to force fresh render
      if (messageDataCache) messageDataCache.clear();
      wrappedRefreshAllCards();
    });
    eventSource.on(event_types.MORE_MESSAGES_LOADED, wrappedRefreshAllCards);
    eventSource.on(event_types.MESSAGE_UPDATED, wrappedRefreshAllCards);
    
    eventSource.on(event_types.MESSAGE_EDITED, (mesId) => {
      log(`Message ${mesId} was edited. Re-rendering tracker card.`);
      renderTrackerWithoutSim(mesId, get_settings, compiledWrapperTemplate, compiledCardTemplate, getReactionEmoji, darkenColor, lastSimJsonString);
    });
    
    // MESSAGE_SWIPE is not available in all ST versions
    if (event_types.MESSAGE_SWIPE) {
      eventSource.on(event_types.MESSAGE_SWIPE, (mesId) => {
        log(
          `Message swipe detected for message ID ${mesId}. Updating last_sim_stats macro.`
        );
        const updatedStats = updateLastSimStatsOnRegenerateOrSwipe(mesId, get_settings);
        if (updatedStats) {
          lastSimJsonString = updatedStats;
        }
      });
    }

    // Listen for generation ended event to update sidebars
    eventSource.on(event_types.GENERATION_ENDED, () => {
      log("Generation ended, updating sidebars if needed");
      setGenerationInProgress(false);

      // Update left sidebar if there's pending content
      if (pendingLeftSidebarContent) {
        updateLeftSidebar(pendingLeftSidebarContent);
        // Note: pendingLeftSidebarContent is managed within renderer module
      }

      // Update right sidebar if there's pending content
      if (pendingRightSidebarContent) {
        updateRightSidebar(pendingRightSidebarContent);
        // Note: pendingRightSidebarContent is managed within renderer module
      }

      // Clear any remaining preparing text when generation ends
      document.querySelectorAll(".sst-preparing-text").forEach((element) => {
        const mesText = element.previousElementSibling;
        if (mesText && mesText.classList.contains("mes_text")) {
          mesTextsWithPreparingText.delete(mesText);
        }
        element.remove();
      });
      // set this back on because jhghfjgf
      setGenerationInProgress(true);
    });

    wrappedRefreshAllCards();
    log(`${MODULE_NAME} has been successfully loaded.`);
  } catch (error) {
    console.error(
      `[${MODULE_NAME}] A critical error occurred during initialization. The extension may not work correctly. Error: ${error.stack}`
    );
  }
});
