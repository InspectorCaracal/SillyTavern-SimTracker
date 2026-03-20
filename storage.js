// storage.js - Metadata-based storage for SimTracker data
import { getContext } from "../../../extensions.js";

const MODULE_NAME = "silly-sim-tracker";

// Initialize metadata storage if it doesn't exist
const initMetadata = () => {
  const context = getContext();
  const meta = context.chatMetadata;
  
  if (!meta.sim_tracker) {
    meta.sim_tracker = {
      version: 1,
      worldData: {},
      cards: {},
      lastUpdated: Date.now()
    };
    context.saveMetadata();
  }
  
  return meta.sim_tracker;
};

// Get the metadata storage object
const getMetadata = () => {
  const context = getContext();
  const meta = context.chatMetadata;
  
  if (!meta.sim_tracker) {
    return initMetadata();
  }
  
  return meta.sim_tracker;
};

// Save metadata changes
const saveMetadata = () => {
  const context = getContext();
  const meta = context.chatMetadata;
  
  if (meta.sim_tracker) {
    meta.sim_tracker.lastUpdated = Date.now();
    context.saveMetadata();
  }
};

// Update world data (direct replacement)
const updateWorldData = (worldData) => {
  const storage = getMetadata();
  
  Object.keys(worldData).forEach(key => {
    // Skip internal/system keys
    if (key.startsWith('_')) return;
    
    storage.worldData[key] = worldData[key];
  });
  
  saveMetadata();
};

// Get world data
const getWorldData = () => {
  const storage = getMetadata();
  return { ...storage.worldData };
};

// Update card data with merge logic
const updateCardData = (cardName, stats) => {
  const storage = getMetadata();
  
  // Initialize card if not exists
  if (!storage.cards[cardName]) {
    storage.cards[cardName] = {
      name: cardName,
      firstSeen: Date.now(),
      data: {}
    };
  }
  
  const cardData = storage.cards[cardName].data;
  
  // Process each stat
  Object.keys(stats).forEach(key => {
    // Skip the name field (already stored)
    if (key === 'name') return;
    
    // Skip display/system keys
    if (['bg', 'bgColor', 'color', 'internal_thought', 'thought', 'last_react'].includes(key)) {
      return;
    }
    
    const value = stats[key];
    
    // Handle list add operations (e.g., inventoryAdd)
    if (key.endsWith('Add') && Array.isArray(value)) {
      const baseKey = key.slice(0, -3); // Remove 'Add' suffix
      if (!cardData[baseKey]) {
        cardData[baseKey] = [];
      }
      if (!Array.isArray(cardData[baseKey])) {
        cardData[baseKey] = [cardData[baseKey]];
      }
      // Append new items
      value.forEach(item => {
        if (!cardData[baseKey].includes(item)) {
          cardData[baseKey].push(item);
        }
      });
    }
    // Handle list remove operations (e.g., inventoryRemove)
    else if (key.endsWith('Remove') && Array.isArray(value)) {
      const baseKey = key.slice(0, -6); // Remove 'Remove' suffix
      if (cardData[baseKey] && Array.isArray(cardData[baseKey])) {
        // Remove specified items
        cardData[baseKey] = cardData[baseKey].filter(item => !value.includes(item));
      }
    }
    // Handle change operations (e.g., apChange)
    else if (key.endsWith('Change')) {
      const baseKey = key.slice(0, -6); // Remove 'Change' suffix
      const changeValue = value;
      
      if (typeof changeValue === 'number') {
        // Numeric change - add to existing or initialize
        const currentValue = typeof cardData[baseKey] === 'number' ? cardData[baseKey] : 0;
        cardData[baseKey] = currentValue + changeValue;
      }
      else if (typeof changeValue === 'object' && changeValue !== null) {
        // List change operations
        if (!cardData[baseKey]) {
          cardData[baseKey] = [];
        }
        if (!Array.isArray(cardData[baseKey])) {
          cardData[baseKey] = [cardData[baseKey]];
        }
        
        // Handle add/remove within the change object
        if (changeValue.add && Array.isArray(changeValue.add)) {
          changeValue.add.forEach(item => {
            if (!cardData[baseKey].includes(item)) {
              cardData[baseKey].push(item);
            }
          });
        }
        if (changeValue.remove && Array.isArray(changeValue.remove)) {
          cardData[baseKey] = cardData[baseKey].filter(item => !changeValue.remove.includes(item));
        }
      }
    }
    // Direct value assignment (replaces existing)
    else {
      cardData[key] = value;
    }
  });
  
  saveMetadata();
};

// Get accumulated data for a specific card
const getCardData = (cardName) => {
  const storage = getMetadata();
  const card = storage.cards[cardName];
  
  if (!card) {
    return null;
  }
  
  return {
    name: card.name,
    ...card.data
  };
};

// Get all cards' accumulated data
const getAllCards = () => {
  const storage = getMetadata();
  const result = {};
  
  Object.keys(storage.cards).forEach(name => {
    const card = storage.cards[name];
    result[name] = {
      name: card.name,
      ...card.data
    };
  });
  
  return result;
};

// Get list of all card names
const getCardNames = () => {
  const storage = getMetadata();
  // Handle case where cards doesn't exist (migration from old format or empty)
  if (!storage.cards) {
    storage.cards = {};
    return [];
  }
  return Object.keys(storage.cards);
};

// Process a complete sim data block (world + cards)
const processSimData = (data) => {
  // Update world data if present
  if (data.worldData) {
    updateWorldData(data.worldData);
  }
  
  // Update card data
  if (data.cards && Array.isArray(data.cards)) {
    data.cards.forEach(card => {
      if (card.name) {
        updateCardData(card.name, card);
      }
    });
  }
};

// Migrate existing chat data to metadata (one-time operation)
// identifier: optional code block identifier (defaults to "sim")
const migrateChatToMetadata = async (identifier = "sim") => {
  const context = getContext();
  const { parseTrackerData } = await import("./formatUtils.js");
  
  // Initialize fresh metadata
  const storage = getMetadata();
  storage.worldData = {};
  storage.cards = {};
  
  let migratedCount = 0;
  
  // Build regex with escaped identifier
  const escapedIdentifier = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const simRegex = new RegExp("```" + escapedIdentifier + "[\\s\\S]*?```", "gm");
  
  // Process all messages in chat
  if (context.chat && Array.isArray(context.chat)) {
    context.chat.forEach(message => {
      if (!message.mes) return;
      
      // Look for sim blocks with dynamic identifier
      const matches = message.mes.match(simRegex);
      
      if (matches) {
        matches.forEach(block => {
          try {
            const content = block
              .replace(/```/g, "")
              .replace(new RegExp("^" + escapedIdentifier + "\\s*"), "")
              .trim();
            
            const data = parseTrackerData(content);
            
            if (data) {
              processSimData(data);
              migratedCount++;
            }
          } catch (error) {
            console.log(`[SST] Migration error for message: ${error.message}`);
          }
        });
      }
    });
  }
  
  saveMetadata();
  return migratedCount;
};

// Check if metadata is initialized
const isMetadataInitialized = () => {
  const context = getContext();
  return !!(context.chatMetadata && context.chatMetadata.sim_tracker);
};

export {
  initMetadata,
  getMetadata,
  saveMetadata,
  updateWorldData,
  getWorldData,
  updateCardData,
  getCardData,
  getAllCards,
  getCardNames,
  processSimData,
  migrateChatToMetadata,
  isMetadataInitialized
};
