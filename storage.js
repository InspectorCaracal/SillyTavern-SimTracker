// storage.js - Metadata-based storage for SimTracker data
import { getContext } from "../../../extensions.js";

const MODULE_NAME = "silly-sim-tracker";

// Initialize metadata storage if it doesn't exist
const initMetadata = () => {
  const context = getContext();
  const meta = context.chatMetadata;
  
  if (!meta.sim_tracker) {
    meta.sim_tracker = {
      version: 3,
      worldData: {},
      cards: {},
      lastUpdated: Date.now(),
      // Snapshot for swipe support
      preLastMessageSnapshot: null,
      lastProcessedMesId: -1,
      lastProcessedSwipeId: -1
    };
    context.saveMetadata();
  }
  
  // Migrate old metadata to new structure if needed
  migrateMetadataStructure(meta.sim_tracker);
  
  return meta.sim_tracker;
};

// Migrate old metadata structures to current version
const migrateMetadataStructure = (storage) => {
  if (!storage.version || storage.version < 3) {
    // Add snapshot fields for version 3
    storage.preLastMessageSnapshot = null;
    storage.lastProcessedMesId = -1;
    storage.lastProcessedSwipeId = -1;
    storage.version = 3;
    
    const context = getContext();
    context.saveMetadata();
    console.log(`[SST] Migrated metadata to version 3 (added swipe snapshot support)`);
  }
};

// Save snapshot of current metadata state before processing a new message
const savePreMessageSnapshot = () => {
  const storage = getMetadata();
  
  const snapshot = {
    worldData: JSON.parse(JSON.stringify(storage.worldData)),
    cards: JSON.parse(JSON.stringify(storage.cards))
  };
  
  storage.preLastMessageSnapshot = snapshot;
  
  saveMetadata();
  
  console.log(`[SST] Saved pre-message snapshot. Cards: ${Object.keys(snapshot.cards).length}, WorldData keys: ${Object.keys(snapshot.worldData).length}`);
};

// Restore metadata from pre-message snapshot (used when switching swipes)
const restoreFromSnapshot = () => {
  const storage = getMetadata();
  
  if (!storage.preLastMessageSnapshot) {
    console.log(`[SST] No snapshot available to restore from`);
    return false;
  }
  
  storage.worldData = JSON.parse(JSON.stringify(storage.preLastMessageSnapshot.worldData));
  storage.cards = JSON.parse(JSON.stringify(storage.preLastMessageSnapshot.cards));
  
  saveMetadata();
  console.log(`[SST] Restored metadata from pre-last-message snapshot`);
  return true;
};

// Clear snapshot and tracking IDs (used by /sst-init-metadata)
const clearSnapshot = () => {
  const storage = getMetadata();
  
  storage.preLastMessageSnapshot = null;
  storage.lastProcessedMesId = -1;
  storage.lastProcessedSwipeId = -1;
  
  saveMetadata();
  console.log(`[SST] Cleared swipe snapshot and tracking data`);
};

// Update tracking IDs for the last processed message
const updateTrackingIds = (mesId, swipeId) => {
  const storage = getMetadata();
  
  storage.lastProcessedMesId = mesId;
  storage.lastProcessedSwipeId = swipeId;
  
  saveMetadata();
};

// Get tracking IDs
const getTrackingIds = () => {
  const storage = getMetadata();
  
  return {
    mesId: storage.lastProcessedMesId,
    swipeId: storage.lastProcessedSwipeId
  };
};

// Check if snapshot exists
const hasSnapshot = () => {
  const storage = getMetadata();
  return !!storage.preLastMessageSnapshot;
};

// Get the metadata storage object
const getMetadata = () => {
  const context = getContext();
  const meta = context.chatMetadata;
  
  if (!meta.sim_tracker) {
    return initMetadata();
  }
  
  // Always run migration to ensure structure is up to date
  migrateMetadataStructure(meta.sim_tracker);
  
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

// Check if a value is an operation object (has add, subtract, remove, or icon keys)
const isOperationObject = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const operationKeys = ['add', 'subtract', 'remove', 'icon', 'value'];
  return Object.keys(value).some(key => operationKeys.includes(key));
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
    
    // Skip old suffix-based operation keys (deprecated)
    if (key.endsWith('Add') || key.endsWith('Remove') || key.endsWith('Change')) {
      return;
    }
    
    // Skip old icon-related keys (deprecated)
    if (key === 'icons' || key.endsWith('Icon') || key.endsWith('_icon') || key.startsWith('icon_')) {
      return;
    }
    
    // Skip display/system keys
    if (['bg', 'bgColor', 'internal_thought', 'thought', 'last_react'].includes(key)) {
      return;
    }
    
    const value = stats[key];
    
    // Handle new unified operation object format
    if (isOperationObject(value)) {
      // Initialize field if not exists
      if (cardData[key] === undefined) {
        // Determine if this should be a number or array based on operations
        if (value.add !== undefined || value.subtract !== undefined) {
          cardData[key] = 0;
        } else if (value.remove !== undefined) {
          cardData[key] = [];
        }
      }
      
      // Store icon metadata if present
      if (value.icon !== undefined) {
        if (!cardData._icons) {
          cardData._icons = {};
        }
        cardData._icons[key] = value.icon;
      }
      
      // Handle numeric operations (add/subtract)
      if (typeof cardData[key] === 'number') {
        if (typeof value.add === 'number') {
          cardData[key] += value.add;
        }
        if (typeof value.subtract === 'number') {
          cardData[key] -= value.subtract;
        }
        // Handle explicit value override
        if (value.value !== undefined && typeof value.value === 'number') {
          cardData[key] = value.value;
        }
      }
      
      // Handle array operations (add/remove)
      if (Array.isArray(cardData[key]) || value.add !== undefined || value.remove !== undefined) {
        if (!Array.isArray(cardData[key])) {
          cardData[key] = cardData[key] !== undefined ? [cardData[key]] : [];
        }
        
        if (value.add !== undefined) {
          const itemsToAdd = Array.isArray(value.add) ? value.add : [value.add];
          itemsToAdd.forEach(item => {
            if (!cardData[key].includes(item)) {
              cardData[key].push(item);
            }
          });
        }
        
        if (value.remove !== undefined) {
          const itemsToRemove = Array.isArray(value.remove) ? value.remove : [value.remove];
          cardData[key] = cardData[key].filter(item => !itemsToRemove.includes(item));
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
  isMetadataInitialized,
  savePreMessageSnapshot,
  restoreFromSnapshot,
  clearSnapshot,
  updateTrackingIds,
  getTrackingIds,
  hasSnapshot
};
