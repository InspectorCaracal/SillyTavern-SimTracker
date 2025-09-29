// renderer.js - HTML card rendering code
import { getContext } from "../../../extensions.js";
import { messageFormatting } from "../../../../script.js";
import { extractTemplatePosition, currentTemplatePosition } from "./templating.js";
import { parseTrackerData } from "./formatUtils.js";
import { extractDisplayableFields, generateDynamicStatsHtml } from "./fieldMapping.js";
import { getGlobalVariable, setGlobalVariable } from "../../../variables.js";

const MODULE_NAME = "silly-sim-tracker";
const CONTAINER_ID = "silly-sim-tracker-container";

// Global sidebar tracker elements
let globalLeftSidebar = null;
let globalRightSidebar = null;
let pendingLeftSidebarContent = null;
let pendingRightSidebarContent = null;
let isGenerationInProgress = false;
let generationType = null;

// Keep track of mesTexts that have preparing text
const mesTextsWithPreparingText = new Set();

// State management functions
const setGenerationInProgress = (value) => {
  isGenerationInProgress = value;
};

const getGenerationInProgress = () => {
  return isGenerationInProgress;
};

const setGenerationType = (value) => {
  generationType = value;
}

const getGenerationType = () => {
  return generationType;
}

const clearGenerationType = () => {
  generationType = null;
}

// Process data synchronization for characters with data sync enabled
function processCharacterDataSync(worldData, characterList) {
  console.log("[SST] initiating data persist")

  // update world data variables first
  Object.keys(worldData).forEach(key => {
    const variableName = `worldData_${key}`;
    setGlobalVariable(variableName, JSON.stringify(worldData[key]));
  })

  characterList.forEach(character => {
    const { name, ...stats } = character;
    
    // Check if the character has data sync enabled (any boolean key that enables sync)
    const enableSync = stats.enableDataSync || stats.dataSync || stats.syncData || stats.trackChanges;
    
    if (!enableSync) return; // Skip if sync is not enabled for this character
    
    // Define keys that should not be synced (display/system keys)
    const excludedKeys = ['bg', 'bgColor', 'color', 'internal_thought', 'thought', 'last_react', 'enableDataSync', 'dataSync', 'syncData', 'trackChanges'];
    
    // First pass: Process direct value assignments for non-excluded keys
    Object.keys(stats).forEach(key => {
      if (!key.endsWith('Change') && !excludedKeys.includes(key)) {
        const value = stats[key];
        const variableName = `${name}_${key}`;
        
        try {
          // Handle numeric values
          if (typeof value === 'number') {
            setGlobalVariable(variableName, value);
            console.log(`[SST] [${MODULE_NAME}]`, 
              `Set ${variableName} to: ${value}`);
          }
          // Handle arrays/lists
          else if (Array.isArray(value)) {
            setGlobalVariable(variableName, JSON.stringify(value));
            console.log(`[SST] [${MODULE_NAME}]`, 
              `Set list ${variableName} to: [${value.join(', ')}]`);
          }
          // Handle other values (strings, etc.)
          else if (value !== null && value !== undefined) {
            setGlobalVariable(variableName, value);
            console.log(`[SST] [${MODULE_NAME}]`, 
              `Set ${variableName} to: ${value}`);
          }
        } catch (error) {
          console.error(`[SST] [${MODULE_NAME}]`, 
            `Error setting variable ${variableName}:`, error);
        }
      }
    });
    
    // Second pass: Process xChange keys only if their base key is NOT present
    Object.keys(stats).forEach(key => {
      if (key.endsWith('Change')) {
        const baseKey = key.replace('Change', ''); // e.g., 'apChange' -> 'ap'
        
        // Only process the change if the base key is NOT present in the data
        if (!(baseKey in character)) {
          const changeValue = stats[key];
          const variableName = `${name}_${baseKey}`;
          
          try {
            // Handle numeric changes
            if (typeof changeValue === 'number' && changeValue !== 0) {
              // Get current value or initialize to 0
              const currentValue = getGlobalVariable(variableName) || 0;
              const newValue = Number(currentValue) + changeValue;
              
              // Set the updated value
              setGlobalVariable(variableName, newValue);
              
              console.log(`[SST] [${MODULE_NAME}]`, 
                `Updated ${variableName}: ${currentValue} + ${changeValue} = ${newValue}`);
            }
            // Handle list modifications
            else if (typeof changeValue === 'object' && changeValue !== null) {
              // Get current list or initialize to empty array
              let currentList;
              try {
                const currentValue = getGlobalVariable(variableName);
                currentList = currentValue ? JSON.parse(currentValue) : [];
                if (!Array.isArray(currentList)) {
                  currentList = [];
                }
              } catch (parseError) {
                console.log(`[SST] [${MODULE_NAME}]`, 
                  `Could not parse existing list for ${variableName}, initializing as empty array`);
                currentList = [];
              }
              
              let modified = false;
              
              // Handle additions
              if (changeValue.add && Array.isArray(changeValue.add)) {
                changeValue.add.forEach(item => {
                  if (!currentList.includes(item)) {
                    currentList.push(item);
                    modified = true;
                    console.log(`[SST] [${MODULE_NAME}]`, 
                      `Added "${item}" to ${variableName}`);
                  }
                });
              }
              
              // Handle removals
              if (changeValue.remove && Array.isArray(changeValue.remove)) {
                changeValue.remove.forEach(item => {
                  const index = currentList.indexOf(item);
                  if (index > -1) {
                    currentList.splice(index, 1);
                    modified = true;
                    console.log(`[SST] [${MODULE_NAME}]`, 
                      `Removed "${item}" from ${variableName}`);
                  }
                });
              }
              
              // Save the updated list if it was modified
              if (modified) {
                setGlobalVariable(variableName, JSON.stringify(currentList));
                console.log(`[SST] [${MODULE_NAME}]`, 
                  `Updated list ${variableName}: [${currentList.join(', ')}]`);
              }
            }
          } catch (error) {
            console.error(`[SST] [${MODULE_NAME}]`, 
              `Error updating variable ${variableName}:`, error);
          }
        } else {
          console.log(`[SST] [${MODULE_NAME}]`, 
            `Skipping ${key} because ${baseKey} is present in data`);
        }
      }
    });
  });
}

// Backfill missing base keys with their corresponding global variable values
function backfillMissingKeys(characterList, withSim) {
  const retrieveValue = withSim ? getGlobalVariable : (varname) => "?";

  characterList.forEach(character => {
    const { name, ...stats } = character;
    
    // Find all xChange keys and check if corresponding base keys are missing
    Object.keys(stats).forEach(key => {
      if (key.endsWith('Change')) {
        const baseKey = key.replace('Change', ''); // e.g., 'apChange' -> 'ap'
        
        // If the base key is missing from the character data
        if (!(baseKey in character)) {
          const variableName = `${name}_${baseKey}`;
          // Determine data type by the change to apply
          const isList = stats[key].add || stats[key].remove;
          
          try {
            const storedValue = retrieveValue(variableName);
            
            if (isList) {
              let parsed = false;
              if (storedValue) {
                try {
                  const parsedList = JSON.parse(storedValue);
                  if (Array.isArray(parsedList)) {
                    character[baseKey] = parsedList;
                    console.log(`[SST] [${MODULE_NAME}]`, 
                      `Backfilled ${baseKey} for ${name} with stored list: [${parsedList.join(', ')}]`);
                    parsed = true;
                  }
                } catch (parseError) {
                  console.log(`[SST] [${MODULE_NAME}]`, 
                    `Could not parse stored list for ${baseKey}`);
                }
              }
              if (!parsed) {
                // just represent the changes
                console.log(stats[key]);
                character[baseKey] = stats[key].add ? stats[key].add.map(item => { return {'name': item, 'change': 'add'}}) : [];
                character[baseKey].push(...( stats[key].remove ? stats[key].remove.map(item => { return {'name': item, 'change': 'remove'}}) : []));
                console.log(character[baseKey]);
              }
            }
            // For other stored values, use as-is
            else {
              character[baseKey] = storedValue;
              console.log(`[SST] [${MODULE_NAME}]`, 
                `Backfilled ${baseKey} for ${name} with stored value: ${storedValue}`);
            }
          } catch (error) {
            console.error(`[SST] [${MODULE_NAME}]`, 
              `Error backfilling ${baseKey} for ${name}:`, error);
          }
        }
      }
    });
  });
}

// Helper function to build template context data for characters
function buildTemplateContext(characterList, worldData, templateConfig) {
  const { 
    currentDate, 
    currentTime, 
    defaultBgColor, 
    darkenColor, 
    getReactionEmoji, 
    get_settings,
    extractDisplayableFields,
    generateDynamicStatsHtml,
    isTabbedTemplate
  } = templateConfig;

  if (isTabbedTemplate) {
    // Prepare data for all cards in tabbed format
    const charactersData = characterList
      .map((character, index) => {
        const stats = character;
        const name = character.name;
        if (!stats) {
          console.log(`[SST] [${MODULE_NAME}]`,
            `No stats found for character "${name}". Skipping card.`
          );
          return null;
        }
        const bgColor = stats.bg || stats.bgColor || stats.color || defaultBgColor;
        
        // Extract dynamic fields for this character
        const dynamicFields = extractDisplayableFields(stats, worldData);
        const dynamicStatsHtml = generateDynamicStatsHtml(dynamicFields);
        
        return {
          characterName: name,
          currentDate: currentDate,
          currentTime: currentTime,
          stats: {
            ...stats,
            internal_thought:
              stats.internal_thought ||
              stats.thought ||
              "No thought recorded.",
            relationshipStatus:
              stats.relationshipStatus || "Unknown Status",
            desireStatus: stats.desireStatus || "Unknown Desire",
            inactive: stats.inactive || false,
            inactiveReason: stats.inactiveReason || 0,
          },
          bgColor: bgColor,
          darkerBgColor: darkenColor(bgColor),
          reactionEmoji: getReactionEmoji(stats.last_react),
          healthIcon:
            stats.health === 1 ? "🤕" : stats.health === 2 ? "💀" : null,
          showThoughtBubble: get_settings("showThoughtBubble"),
          dynamicFields: dynamicFields,
          dynamicStatsHtml: dynamicStatsHtml,
          cardIndex: index,
          isActive: index === 0 ? "active" : "",
          ariaSelected: index === 0 ? "true" : "false"
        };
      })
      .filter(Boolean); // Remove any null entries

    // Return template data for tabbed templates
    return {
      cards: charactersData,
      currentDate: currentDate,
      currentTime: currentTime,
      bgColor: defaultBgColor,
      darkerBgColor: darkenColor(defaultBgColor),
      worldData: worldData
    };
  } else {
    // For non-tabbed templates, return an array of individual card data
    return characterList
      .map((character) => {
        const stats = character;
        const name = character.name;
        if (!stats) {
          console.log(`[SST] [${MODULE_NAME}]`,
            `No stats found for character "${name}". Skipping card.`
          );
          return null;
        }
        const bgColor = stats.bg || stats.bgColor || stats.color || defaultBgColor;
        
        // Extract dynamic fields for this character
        const dynamicFields = extractDisplayableFields(stats, worldData);
        const dynamicStatsHtml = generateDynamicStatsHtml(dynamicFields);
        
        return {
          characterName: name,
          currentDate: currentDate,
          currentTime: currentTime,
          stats: {
            ...stats,
            internal_thought:
              stats.internal_thought ||
              stats.thought ||
              "No thought recorded.",
            relationshipStatus:
              stats.relationshipStatus || "Unknown Status",
            desireStatus: stats.desireStatus || "Unknown Desire",
            inactive: stats.inactive || false,
            inactiveReason: stats.inactiveReason || 0,
          },
          bgColor: bgColor,
          darkerBgColor: darkenColor(bgColor),
          reactionEmoji: getReactionEmoji(stats.last_react),
          healthIcon:
            stats.health === 1 ? "🤕" : stats.health === 2 ? "💀" : null,
          showThoughtBubble: get_settings("showThoughtBubble"),
          dynamicFields: dynamicFields,
          dynamicStatsHtml: dynamicStatsHtml,
        };
      })
      .filter(Boolean); // Remove any null entries
  }
}

// Helper function to create or update a global left sidebar
function updateLeftSidebar(content) {
  // If generation is in progress, store the content for later
  if (isGenerationInProgress) {
    pendingLeftSidebarContent = content;
    return;
  }

  // If we don't have a global sidebar yet, create it
  if (!globalLeftSidebar) {
    // Find the sheld container
    const sheld = document.getElementById("sheld");
    console.log(`[SST] [${MODULE_NAME}]`, "Found sheld element:", sheld);
    if (!sheld) {
      console.warn("[SST] Could not find sheld container for sidebar");
      return;
    }

    // Create a container that stretches vertically and position it before sheld
    const verticalContainer = document.createElement("div");
    verticalContainer.id = "sst-global-sidebar-left";
    verticalContainer.className = "vertical-container";
    verticalContainer.style.cssText = `
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          bottom: 0 !important;
          width: auto !important;
          height: 100% !important;
          z-index: 999 !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          padding: 10px !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: center !important;
          align-items: flex-start !important;
          visibility: visible !important;
          overflow: visible !important;
      `;
    console.log(`[SST] [${MODULE_NAME}]`, "Created verticalContainer");

    // Create the actual sidebar content container
    const leftSidebar = document.createElement("div");
    leftSidebar.id = "sst-sidebar-left-content";
    leftSidebar.innerHTML = content;
    leftSidebar.style.cssText = `
          width: auto !important;
          height: 100% !important;
          max-width: 300px !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          display: block !important;
          visibility: visible !important;
          overflow: visible !important;
          position: relative !important;
      `;
    console.log(`[SST] [${MODULE_NAME}]`, "Applied styles to leftSidebar");

    // Add the sidebar to the vertical container
    verticalContainer.appendChild(leftSidebar);
    console.log(`[SST] [${MODULE_NAME}]`, "Appended leftSidebar to verticalContainer");

    // Store reference to global sidebar
    globalLeftSidebar = verticalContainer;
    console.log(`[SST] [${MODULE_NAME}]`, "Stored reference to globalLeftSidebar");

    // Insert the sidebar container directly before the sheld div in the body
    if (sheld.parentNode) {
      sheld.parentNode.insertBefore(verticalContainer, sheld);
      console.log(`[SST] [${MODULE_NAME}]`, "Successfully inserted left sidebar before sheld");
    } else {
      console.error("[SST] sheld has no parent node!");
      // Fallback: append to body
      document.body.appendChild(verticalContainer);
    }

    // Add event listeners for tabs (only once when creating)
    attachTabEventListeners(leftSidebar);

    // Debug: Log the final container
    console.log(`[SST] [${MODULE_NAME}]`, "Created left sidebar container:", verticalContainer);

    return verticalContainer;
  } else {
    // Update existing sidebar content without re-attaching event listeners
    const leftSidebar = globalLeftSidebar.querySelector(
      "#sst-sidebar-left-content"
    );
    if (leftSidebar) {
      leftSidebar.innerHTML = content;
    }
  }
}

// Helper function to create or update a global right sidebar
function updateRightSidebar(content) {
  // If generation is in progress, store the content for later
  if (isGenerationInProgress) {
    pendingRightSidebarContent = content;
    return;
  }

  // If we don't have a global sidebar yet, create it
  if (!globalRightSidebar) {
    // Find the sheld container
    const sheld = document.getElementById("sheld");
    if (!sheld) {
      console.warn("[SST] Could not find sheld container for sidebar");
      return;
    }

    // Create a container that stretches vertically and position it before sheld
    const verticalContainer = document.createElement("div");
    verticalContainer.id = "sst-global-sidebar-right";
    verticalContainer.className = "vertical-container";
    verticalContainer.style.cssText = `
          position: absolute !important;
          right: 0 !important;
          top: 0 !important;
          bottom: 0 !important;
          width: auto !important;
          height: 100% !important;
          z-index: 999 !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          padding: 10px !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          display: flex !important;
          flex-direction: column !important;
          justify-content: center !important;
          align-items: flex-end !important;
          visibility: visible !important;
          overflow: visible !important;
      `;
    console.log(`[SST] [${MODULE_NAME}]`, "Created verticalContainer");

    // Create the actual sidebar content container
    const rightSidebar = document.createElement("div");
    rightSidebar.id = "sst-sidebar-right-content";
    rightSidebar.innerHTML = content;
    rightSidebar.style.cssText = `
          width: auto !important;
          height: 100% !important;
          max-width: 300px !important;
          box-sizing: border-box !important;
          margin: 0 !important;
          padding: 0 !important;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
          display: block !important;
          visibility: visible !important;
          overflow: visible !important;
          position: relative !important;
      `;

    // Add the sidebar to the vertical container
    verticalContainer.appendChild(rightSidebar);
    console.log(`[SST] [${MODULE_NAME}]`, "Appended rightSidebar to verticalContainer");

    // Store reference to global sidebar
    globalRightSidebar = verticalContainer;
    console.log(`[SST] [${MODULE_NAME}]`, "Stored reference to globalRightSidebar");

    // Insert the sidebar container directly before the sheld div in the body
    if (sheld.parentNode) {
      sheld.parentNode.insertBefore(verticalContainer, sheld);
      console.log(`[SST] [${MODULE_NAME}]`, "Successfully inserted right sidebar before sheld");
    } else {
      console.error("[SST] sheld has no parent node!");
      // Fallback: append to body
      document.body.appendChild(verticalContainer);
    }

    // Add event listeners for tabs (only once when creating)
    attachTabEventListeners(rightSidebar);

    return verticalContainer;
  } else {
    // Update existing sidebar content without re-attaching event listeners
    const rightSidebar = globalRightSidebar.querySelector(
      "#sst-sidebar-right-content"
    );
    if (rightSidebar) {
      rightSidebar.innerHTML = content;
    }
  }
}

// Helper function to remove global sidebars
function removeGlobalSidebars() {
  if (globalLeftSidebar) {
    // Remove event listeners before removing the sidebar
    const leftSidebar = globalLeftSidebar.querySelector(
      "#sst-sidebar-left-content"
    );
    if (leftSidebar) {
      // Remove any existing event listeners by cloning and replacing
      const newLeftSidebar = leftSidebar.cloneNode(true);
      leftSidebar.parentNode.replaceChild(newLeftSidebar, leftSidebar);
    }
    globalLeftSidebar.remove();
    globalLeftSidebar = null;
  }
  if (globalRightSidebar) {
    // Remove event listeners before removing the sidebar
    const rightSidebar = globalRightSidebar.querySelector(
      "#sst-sidebar-right-content"
    );
    if (rightSidebar) {
      // Remove any existing event listeners by cloning and replacing
      const newRightSidebar = rightSidebar.cloneNode(true);
      rightSidebar.parentNode.replaceChild(newRightSidebar, rightSidebar);
    }
    globalRightSidebar.remove();
    globalRightSidebar = null;
  }
}

// Helper function to attach tab event listeners
function attachTabEventListeners(sidebarElement) {
  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    const tabs = sidebarElement.querySelectorAll(".sim-tracker-tab");
    const cards = sidebarElement.querySelectorAll(".sim-tracker-card");

    if (tabs.length > 0 && cards.length > 0) {
      // Initially activate the first non-inactive tab and card
      let firstActiveIndex = 0;
      // Find the first non-inactive card
      for (let i = 0; i < cards.length; i++) {
        if (!cards[i].classList.contains("inactive")) {
          firstActiveIndex = i;
          break;
        }
      }

      if (tabs[firstActiveIndex])
        tabs[firstActiveIndex].classList.add("active");
      if (cards[firstActiveIndex])
        cards[firstActiveIndex].classList.add("active");

      // Add click listeners to tabs
      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => {
          // Check if this tab is already active
          const isActive = tab.classList.contains("active");

          // Remove active class from all tabs
          tabs.forEach((t) => t.classList.remove("active"));

          // Handle card and tab animations
          cards.forEach((card, cardIndex) => {
            const correspondingTab = tabs[cardIndex];
            if (cardIndex === index && !isActive) {
              // Slide in the selected card and tab
              card.classList.remove("sliding-out", "tab-hidden");
              card.classList.add("sliding-in");
              if (correspondingTab) {
                correspondingTab.classList.remove("sliding-out", "tab-hidden");
                correspondingTab.classList.add("sliding-in");
              }
              // Add active class after a short delay to ensure the animation works
              setTimeout(() => {
                card.classList.remove("sliding-in");
                card.classList.add("active");
                if (correspondingTab) {
                  correspondingTab.classList.remove("sliding-in");
                  correspondingTab.classList.add("active");
                }
              }, 10);
            } else {
              // Slide out all other cards and tabs
              if (card.classList.contains("active")) {
                card.classList.remove("active");
                card.classList.remove("sliding-in");
                card.classList.add("sliding-out");
                if (correspondingTab) {
                  correspondingTab.classList.remove("active");
                  correspondingTab.classList.remove("sliding-in");
                  correspondingTab.classList.add("sliding-out");
                }
                // Add tab-hidden class after animation completes
                setTimeout(() => {
                  card.classList.add("tab-hidden");
                  card.classList.remove("sliding-out");
                  if (correspondingTab) {
                    correspondingTab.classList.add("tab-hidden");
                    correspondingTab.classList.remove("sliding-out");
                  }
                }, 300);
              }
            }
          });

          // If the clicked tab wasn't already active, activate it
          if (!isActive) {
            tab.classList.add("active");
          }
        });
      });
    }

    const container = sidebarElement.querySelector(
      "#silly-sim-tracker-container"
    );
    if (container) {
      container.style.cssText += `
                width: 100% !important;
                max-width: 100% !important;
                box-sizing: border-box !important;
                display: block !important;
                visibility: visible !important;
                height: 100%;
            `;
    }

    // Force reflow to ensure proper rendering
    sidebarElement.offsetHeight;
  }, 0);
}

// --- RENDER LOGIC ---
const renderTracker = (mesId, get_settings, compiledWrapperTemplate, compiledCardTemplate, getReactionEmoji, darkenColor, lastSimJsonString, withSim = true) => {
  try {
    if (!get_settings("isEnabled")) return;
    const context = getContext();
    const message = context.chat[mesId];
    if (!message) {
      console.log(`[SST] [${MODULE_NAME}]`, `Error: Could not find message with ID ${mesId}. Aborting render.`);
      return;
    }
    const messageElement = document.querySelector(
      `div[mesid="${mesId}"] .mes_text`
    );
    if (!messageElement) return;

    // Log message element dimensions for debugging layout issues
    const messageRect = messageElement.getBoundingClientRect();
    console.log(`[SST] [${MODULE_NAME}]`,
      `Message ID ${mesId} dimensions - Width: ${messageRect.width.toFixed(
        2
      )}px, Height: ${messageRect.height.toFixed(2)}px`
    );

    // Parse the sim data from the original message content
    const identifier = get_settings("codeBlockIdentifier");
    const jsonRegex = new RegExp("```" + identifier + "[\\s\\S]*?```", "gm");
    const matches = message.mes.match(jsonRegex);

    // Determine which data to use
    let dataToProcess = null;
    let shouldProcessData = false;

    if (matches && withSim) {
      // renderTracker: process sim data from current message (could be multiple blocks)
      dataToProcess = matches;
      shouldProcessData = true;
      // Set flag to indicate we're processing a message with sim data
      isGenerationInProgress = true;
    } else if (matches && !withSim) {
      // renderTrackerWithoutSim: process sim data from current message (could be multiple blocks)
      dataToProcess = matches;
      shouldProcessData = true;
      // Remove existing container to prevent duplication
      const existingContainer = messageElement.querySelector(`#${CONTAINER_ID}`);
      if (existingContainer) {
        existingContainer.remove();
      }
    } else if (!withSim && lastSimJsonString) {
      // renderTrackerWithoutSim fallback: use previous sim data if available
      dataToProcess = [`\`\`\`${identifier}\n${lastSimJsonString}\n\`\`\``];
      shouldProcessData = true;
    }

    // Handle message formatting (remove or replace sim blocks if setting is enabled and blocks are present)
    let displayMessage = message.mes;
    if (matches && get_settings("hideSimBlocks")) {
      const hideRegex = new RegExp("```" + identifier + "[\\s\\S]*?```", "gm");
      const templatePosition = currentTemplatePosition;
      
      if (templatePosition === "INLINE") {
        // For INLINE position, replace with placeholder that we can find later
        let blockIndex = 0;
        displayMessage = displayMessage.replace(hideRegex, () => {
          return `[SST_INLINE_PLACEHOLDER_${blockIndex++}]`;
        });
        console.log(`[SST] [${MODULE_NAME}]`, `displayMessage after placeholder replacement:`, displayMessage.substring(0, 500));
      } else {
        // For other positions, remove blocks entirely
        displayMessage = displayMessage.replace(hideRegex, "");
      }
    }

    // Format and display the message content
    const formattedMessage = messageFormatting(
      displayMessage,
      message.name,
      message.is_system,
      message.is_user,
      mesId
    );
    console.log(`[SST] [${MODULE_NAME}]`, `formattedMessage after messageFormatting:`, formattedMessage.substring(0, 500));
    messageElement.innerHTML = formattedMessage;

    if (shouldProcessData && dataToProcess) {
      let mergedWorldData = {};
      let allCharacters = [];
      let lastProcessedContent = "";
      let simBlocksData = []; // Store data for each sim block separately for INLINE positioning

      // Remove any preparing text
      const preparingText = messageElement.parentNode.querySelector(".sst-preparing-text");
      if (preparingText) {
        preparingText.remove();
        // Remove this mesText from the set since it no longer has preparing text
        mesTextsWithPreparingText.delete(messageElement);
      }

      // Process each sim block
      for (const block of dataToProcess) {
        try {
          // Extract content from the current block
          const content = block
            .replace(/```/g, "")
            .replace(new RegExp(`^${identifier}\\s*`), "")
            .trim();

          // Skip empty blocks
          if (!content) {
            console.log(`[SST] [${MODULE_NAME}]`, `Empty sim block found in message ID ${mesId}. Skipping.`);
            continue;
          }

          // Keep track of the last processed content for lastSimJsonString
          lastProcessedContent = content;

          // Parse the current block using the user's preferred format
          const userFormat = get_settings("trackerFormat") || "auto";
          // If user chose auto-detect, don't pass a format to let parseTrackerData auto-detect
          const jsonData = userFormat === "auto" ? parseTrackerData(content) : parseTrackerData(content, userFormat);

          if (typeof jsonData !== "object" || jsonData === null) {
            console.log(`[SST] [${MODULE_NAME}]`, `Parsed data in message ID ${mesId} is not a valid object for one sim block. Skipping.`);
            continue;
          }

          // Handle both old and new JSON formats for this block
          let blockWorldData, blockCharacterList;

          // Check if it's the new format (with worldData and cards array)
          if (jsonData.worldData && Array.isArray(jsonData.cards)) {
            blockWorldData = jsonData.worldData;
            blockCharacterList = jsonData.cards;
          } else {
            // Handle old format - convert object structure to array format
            const worldDataFields = ["current_date", "current_time"];
            blockWorldData = {};
            blockCharacterList = [];

            Object.keys(jsonData).forEach((key) => {
              if (worldDataFields.includes(key)) {
                blockWorldData[key] = jsonData[key];
              } else {
                // Convert character object to array item
                blockCharacterList.push({
                  name: key,
                  ...jsonData[key],
                });
              }
            });
          }

          // Merge world data (last block wins for conflicting keys)
          mergedWorldData = { ...mergedWorldData, ...blockWorldData };

          // Store this sim block's data for INLINE positioning
          if (currentTemplatePosition === "INLINE") {
            simBlocksData.push({
              worldData: blockWorldData,
              cards: blockCharacterList || []
            });
          }

          // Add characters from this block, avoiding duplicates by name
          if (blockCharacterList && blockCharacterList.length > 0) {
            blockCharacterList.forEach(character => {
              if (character && character.name) {
                // Remove any existing character with the same name (last occurrence wins)
                allCharacters = allCharacters.filter(existing => existing.name !== character.name);
                allCharacters.push(character);
              }
            });
          }

        } catch (parseError) {
          console.log(`[SST] [${MODULE_NAME}]`,
            `Failed to parse tracker data in one sim block in message ID ${mesId}. Error: ${parseError.message}. Skipping this block.`
          );
          continue;
        }
      }

      // Check if we got any valid data
      if (allCharacters.length === 0) {
        console.log(`[SST] [${MODULE_NAME}]`, `No valid character data found in any sim blocks in message ID ${mesId}.`);
        messageElement.insertAdjacentHTML(
          "beforeend",
          `<div style="color: red; font-family: monospace;">[SillySimTracker] Error: No valid character data found in any sim blocks.</div>`
        );
        return;
      }

      // Update lastSimJsonString with the last processed content
      lastSimJsonString = lastProcessedContent;

      // Use the merged data
      let worldData = mergedWorldData;
      let characterList = allCharacters;

      const currentDate = worldData.current_date || "Unknown Date";
      const currentTime = worldData.current_time || "Unknown Time";
      const defaultBgColor = worldData.bg || worldData.bgColor || worldData.color || get_settings("defaultBgColor");

      if (!characterList.length) return;

      // Integrate globalvar data persistence
      if (withSim) {
        // Process xChange keys for data synchronization
        processCharacterDataSync(worldData, characterList);
      }
      // Backfill missing base keys with stored values
      backfillMissingKeys(characterList, withSim);

      // For tabbed templates, we need to pass all cards to the template
      const templateFile = get_settings("templateFile");
      const customTemplateHtml = get_settings("customTemplateHtml");
      const isTabbedTemplate = templateFile.includes("tabs") ||
                               templateFile.includes("inline") ||
                               (customTemplateHtml && customTemplateHtml.includes("sim-tracker-tabs")) ||
                               (customTemplateHtml && customTemplateHtml.includes("{{#each cards}}"));

      // Build template configuration for the helper
      const templateConfig = {
        currentDate,
        currentTime,
        defaultBgColor,
        darkenColor,
        getReactionEmoji,
        get_settings,
        extractDisplayableFields,
        generateDynamicStatsHtml,
        isTabbedTemplate
      };

      let cardsHtml = "";
      if (isTabbedTemplate) {
        // Use helper to build template context
        const templateData = buildTemplateContext(characterList, worldData, templateConfig);
        cardsHtml = compiledCardTemplate(templateData);
      } else {
        // Use helper to get individual card data
        const cardDataArray = buildTemplateContext(characterList, worldData, templateConfig);
        cardsHtml = cardDataArray
          .map(cardData => compiledCardTemplate(cardData))
          .join("");
      }

      // Use the template position from the templating module
      const templatePosition = currentTemplatePosition;
      console.log(`[SST] [${MODULE_NAME}]`, `Template position for message ${mesId}: "${templatePosition}"`);
      console.log(`[SST] [${MODULE_NAME}]`, `hideSimBlocks setting: ${get_settings("hideSimBlocks")}`);
      console.log(`[SST] [${MODULE_NAME}]`, `matches length: ${matches ? matches.length : 0}`);

      // Handle different positions
      switch (templatePosition) {
        case "ABOVE":
          // Insert above the message content (inside the message block)
          const reasoningElement = messageElement.querySelector(
            ".mes_reasoning_details"
          );
          if (reasoningElement) {
            // Insert above reasoning details if they exist
            const finalHtml =
              compiledWrapperTemplate({ cardsHtml }) +
              `<hr style="margin-top: 15px; margin-bottom: 20px;">`;
            reasoningElement.insertAdjacentHTML("beforebegin", finalHtml);
          } else {
            // If no reasoning details, insert at the beginning of the message
            const finalHtml =
              compiledWrapperTemplate({ cardsHtml }) +
              `<hr style="margin-top: 15px; margin-bottom: 20px;">`;
            messageElement.insertAdjacentHTML("afterbegin", finalHtml);
          }
          break;
        case "LEFT":
          // Update the global left sidebar with the latest data
          updateLeftSidebar(compiledWrapperTemplate({ cardsHtml }));
          break;
        case "RIGHT":
          // Update the global right sidebar with the latest data
          updateRightSidebar(compiledWrapperTemplate({ cardsHtml }));
          break;
        case "MACRO":
          // For MACRO position, replace the placeholder in the message
          const placeholder = messageElement.querySelector(
            "#sst-macro-placeholder"
          );
          if (placeholder) {
            const finalHtml = compiledWrapperTemplate({ cardsHtml });
            placeholder.insertAdjacentHTML("beforebegin", finalHtml);
            placeholder.remove();
          }
          break;
        case "INLINE":
          console.log(`[SST] [${MODULE_NAME}]`, `Executing INLINE case`);
          // For INLINE position, insert cards inline where sim blocks are/were
          
          if (matches && get_settings("hideSimBlocks")) {
            console.log(`[SST] [${MODULE_NAME}]`, `INLINE: sim blocks hidden, looking for text placeholders`);
            // If sim blocks are hidden, look for text placeholders and replace them
            let currentHtml = messageElement.innerHTML;
            console.log(`[SST] [${MODULE_NAME}]`, `Current HTML contains placeholders:`, currentHtml.includes("[SST_INLINE_PLACEHOLDER_"));
            
            // Find all text placeholders (try both formats - with and without double underscores)
            let placeholderRegex = /\[SST_INLINE_PLACEHOLDER_\d+\]/g;
            let placeholderMatches = currentHtml.match(placeholderRegex);
            
            if (!placeholderMatches || placeholderMatches.length === 0) {
              // Try without double underscores in case messageFormatting stripped them
              placeholderRegex = /SST_INLINE_PLACEHOLDER_\d+/g;
              placeholderMatches = currentHtml.match(placeholderRegex);
              console.log(`[SST] [${MODULE_NAME}]`, `Trying without double underscores, found ${placeholderMatches ? placeholderMatches.length : 0} placeholders`);
            }
            
            console.log(`[SST] [${MODULE_NAME}]`, `Found ${placeholderMatches ? placeholderMatches.length : 0} text placeholders`);
            console.log(`[SST] [${MODULE_NAME}]`, `Available sim blocks data: ${simBlocksData.length}`);
            
            if (placeholderMatches && placeholderMatches.length > 0 && simBlocksData.length > 0) {
              // Create individual cards for each sim block
              let updatedHtml = currentHtml;
              
              placeholderMatches.forEach((placeholder, index) => {
                if (index < simBlocksData.length) {
                  // Get data for this specific sim block
                  const blockData = simBlocksData[index];
                  const blockCharacters = blockData.cards; // Use 'cards' instead of 'characters'
                  
                  console.log(`[SST] [${MODULE_NAME}]`, `Creating card for placeholder ${index} with ${blockCharacters.length} characters`);
                  
                  // Process character data for this block only
                  if (blockCharacters.length > 0) {
                    if (withSim) {
                      // Use merged world data for processing, not just block data
                      processCharacterDataSync(worldData, blockCharacters);
                    }
                    backfillMissingKeys(blockCharacters, withSim);
                    
                    // Build template configuration - use merged world data for complete context  
                    const blockTemplateConfig = {
                      currentDate,
                      currentTime,
                      defaultBgColor,
                      darkenColor,
                      getReactionEmoji,
                      get_settings,
                      extractDisplayableFields,
                      generateDynamicStatsHtml,
                      isTabbedTemplate
                    };
                    
                    // Use the helper function to create consistent context
                    let blockCardsHtml = "";
                    if (isTabbedTemplate) {
                      const blockTemplateData = buildTemplateContext(blockCharacters, worldData, blockTemplateConfig);
                      console.log(`[SST] [${MODULE_NAME}]`, `Block template data for placeholder ${index}:`, JSON.stringify(blockTemplateData, null, 2));
                      blockCardsHtml = compiledCardTemplate(blockTemplateData);
                    } else {
                      const blockCardDataArray = buildTemplateContext(blockCharacters, worldData, blockTemplateConfig);
                      blockCardsHtml = blockCardDataArray
                        .map(cardData => {
                          console.log(`[SST] [${MODULE_NAME}]`, `Non-tabbed template data for ${cardData.characterName}:`, JSON.stringify(cardData, null, 2));
                          return compiledCardTemplate(cardData);
                        })
                        .join("");
                    }
                    
                    // Wrap the cards HTML with the wrapper template
                    const blockFinalHtml = compiledWrapperTemplate({ cardsHtml: blockCardsHtml });
                    
                    // Replace this placeholder with the block's cards
                    updatedHtml = updatedHtml.replace(placeholder, blockFinalHtml);
                  } else {
                    // Remove empty placeholder
                    updatedHtml = updatedHtml.replace(placeholder, "");
                  }
                } else {
                  // Remove extra placeholders that don't have corresponding data
                  updatedHtml = updatedHtml.replace(placeholder, "");
                }
              });
              
              messageElement.innerHTML = updatedHtml;
              console.log(`[SST] [${MODULE_NAME}]`, `Updated message HTML with individual inline cards`);
            } else {
              // Fallback: use merged data and insert at the end
              console.log(`[SST] [${MODULE_NAME}]`, `No matching placeholders found, using fallback with merged data`);
              const finalHtmlInline = compiledWrapperTemplate({ cardsHtml });
              messageElement.insertAdjacentHTML("beforeend", finalHtmlInline);
            }
          } else if (matches) {
            // If sim blocks are visible, insert cards after the last sim block
            const codeBlocks = messageElement.querySelectorAll("pre code");
            let lastSimBlock = null;
            
            // Find the last sim block by checking code content
            for (let i = codeBlocks.length - 1; i >= 0; i--) {
              const codeElement = codeBlocks[i];
              const content = codeElement.textContent || "";
              if (content.trim().startsWith(identifier)) {
                lastSimBlock = codeElement.closest("pre");
                break;
              }
            }
            
            const finalHtmlInline = compiledWrapperTemplate({ cardsHtml });
            if (lastSimBlock) {
              lastSimBlock.insertAdjacentHTML("afterend", finalHtmlInline);
            } else {
              // Fallback: insert at the end if we can't find the sim block
              messageElement.insertAdjacentHTML("beforeend", finalHtmlInline);
            }
          } else {
            // No sim blocks found, insert at the end
            const finalHtmlInline = compiledWrapperTemplate({ cardsHtml });
            messageElement.insertAdjacentHTML("beforeend", finalHtmlInline);
          }
          break;
        case "BOTTOM":
        default:
          // Add a horizontal divider before the cards
          const finalHtml =
            `<hr style="margin-top: 15px; margin-bottom: 20px;">` +
            compiledWrapperTemplate({ cardsHtml });
          messageElement.insertAdjacentHTML("beforeend", finalHtml);
          break;
      }
    }
  } catch (error) {
    // Clear the flag on error
    isGenerationInProgress = false;
    console.log(`[SST] [${MODULE_NAME}]`,
      `A critical error occurred in renderTracker for message ID ${mesId}. Please check the console. Error: ${error.stack}`
    );
  }
};

const renderTrackerWithoutSim = (mesId, get_settings, compiledWrapperTemplate, compiledCardTemplate, getReactionEmoji, darkenColor, lastSimJsonString) => {
  // Simply call renderTracker with withSim=false
  return renderTracker(mesId, get_settings, compiledWrapperTemplate, compiledCardTemplate, getReactionEmoji, darkenColor, lastSimJsonString, false);
};

const refreshAllCards = (get_settings, CONTAINER_ID, renderTrackerWithoutSim) => {
  console.log(`[SST] [${MODULE_NAME}]`, "Refreshing all tracker cards on screen.");

  // First, remove all existing tracker containers to prevent duplicates
  document.querySelectorAll(`#${CONTAINER_ID}`).forEach((container) => {
    container.remove();
  });

  // Get all message divs currently in the chat DOM
  const visibleMessages = document.querySelectorAll("div#chat .mes");
  visibleMessages.forEach((messageElement) => {
    const mesId = messageElement.getAttribute("mesid");
    if (mesId) {
      // Call the existing render function for each visible message
      renderTrackerWithoutSim(parseInt(mesId, 10));
    }
  });
};

// Export functions
export {
  updateLeftSidebar,
  updateRightSidebar,
  removeGlobalSidebars,
  attachTabEventListeners,
  renderTracker,
  renderTrackerWithoutSim,
  refreshAllCards,
  mesTextsWithPreparingText,
  isGenerationInProgress,
  pendingLeftSidebarContent,
  pendingRightSidebarContent,
  setGenerationInProgress,
  getGenerationInProgress,
  setGenerationType,
  getGenerationType,
  clearGenerationType,
  processCharacterDataSync,
  backfillMissingKeys,
  buildTemplateContext,
  CONTAINER_ID
};
