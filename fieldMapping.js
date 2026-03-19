// fieldMapping.js - Dynamic field mapping and display configuration
import { DEBUG } from "./utils.js";
//
// Custom Icon Support:
// The JSON block can specify custom icons for any field using these formats:
//   1. Field + "Icon": { "ap": 50, "apIcon": "💖" }
//   2. Field + "_icon": { "ap": 50, "ap_icon": "💖" }
//   3. "icon_" + Field: { "ap": 50, "icon_ap": "💖" }
//   4. Character-level icons object: { "ap": 50, "icons": { "ap": "💖" } }
//   5. World-level icons object (shared across all characters): 
//      worldData: { "icons": { "ap": "💖", "dp": "🌸" } }
//
// Priority order for icon resolution:
//   1. Character-specific icons object (character.icons.fieldName)
//   2. World-level icons object (worldData.icons.fieldName) 
//   3. Character-specific field+Icon keys (character.fieldNameIcon)
//   4. Default pattern-based icons
//
// Examples:
//   ```yaml
//   ap: 50
//   apIcon: 💖
//   dp: 75
//   dpIcon: 🌸
//   energy: 80
//   energyIcon: ⚡
//   ```
//
//   ```yaml
//   ap: 50
//   dp: 75
//   energy: 80
//   icons:
//     ap: 💖
//     dp: 🌸
//     energy: ⚡
//   ```
//
//   ```yaml
//   worldData:
//     icons:
//       ap: 💖
//       dp: 🌸
//       energy: ⚡
//   cards:
//     - name: "Alice"
//       ap: 50
//       dp: 75
//       energy: 80
//     - name: "Bob"  
//       ap: 30
//       dp: 60
//       energy: 90
//   ```

const MODULE_NAME = "silly-sim-tracker";

// Default field mapping for common stat fields
const DEFAULT_FIELD_MAPPING = {
  // Core stats
  ap: { displayName: "AFFECTION", icon: "❤️", type: "stat", maxValue: 200 },
  dp: { displayName: "DESIRE", icon: "🔥", type: "stat", maxValue: 150 },
  tp: { displayName: "TRUST", icon: "🤝", type: "stat", maxValue: 150 },
  cp: { displayName: "CONTEMPT", icon: "💔", type: "stat", maxValue: 150 },
  
  // Change indicators
  apChange: { displayName: "AFFECTION CHANGE", icon: "❤️", type: "change" },
  dpChange: { displayName: "DESIRE CHANGE", icon: "🔥", type: "change" },
  tpChange: { displayName: "TRUST CHANGE", icon: "🤝", type: "change" },
  cpChange: { displayName: "CONTEMPT CHANGE", icon: "💔", type: "change" },
  
  // Status fields
  relationshipStatus: { displayName: "RELATIONSHIP", icon: "💑", type: "status" },
  desireStatus: { displayName: "DESIRE STATUS", icon: "🔥", type: "status" },
  internal_thought: { displayName: "THOUGHTS", icon: "💭", type: "thought" },
  thought: { displayName: "THOUGHTS", icon: "💭", type: "thought" },
  
  // Health and activity
  health: { displayName: "HEALTH", icon: "💚", type: "stat", maxValue: 2, 
           customIcons: { 0: "💚", 1: "🤕", 2: "💀" } },
  inactive: { displayName: "ACTIVITY", icon: "⚡", type: "boolean" },
  inactiveReason: { displayName: "INACTIVE REASON", icon: "😴", type: "inactive_reason" },
  
  // Time tracking
  days_since_first_meeting: { displayName: "DAYS KNOWN", icon: "📅", type: "stat" },
  days_preg: { displayName: "PREGNANT DAYS", icon: "🤰", type: "stat" },
  
  // Reactions
  last_react: { displayName: "REACTION", icon: "😐", type: "reaction",
               customIcons: { 0: "😐", 1: "👍", 2: "👎" } },
  
  // Appearance
  bg: { displayName: "BACKGROUND", icon: "🎨", type: "color" },
  
  // Pregnancy
  preg: { displayName: "PREGNANT", icon: "🤰", type: "boolean" },
  conception_date: { displayName: "CONCEPTION DATE", icon: "📅", type: "date" },
  
  // Generic fallbacks for common patterns
  level: { displayName: "LEVEL", icon: "⭐", type: "stat" },
  xp: { displayName: "EXPERIENCE", icon: "⚡", type: "stat" },
  energy: { displayName: "ENERGY", icon: "🔋", type: "stat", maxValue: 100 },
  stamina: { displayName: "STAMINA", icon: "💪", type: "stat", maxValue: 100 },
  mood: { displayName: "MOOD", icon: "😊", type: "stat" },
  stress: { displayName: "STRESS", icon: "😰", type: "stat" },
  happiness: { displayName: "HAPPINESS", icon: "😄", type: "stat" },
  anger: { displayName: "ANGER", icon: "😡", type: "stat" },
  fear: { displayName: "FEAR", icon: "😨", type: "stat" },
  love: { displayName: "LOVE", icon: "💕", type: "stat" },
  lust: { displayName: "LUST", icon: "💋", type: "stat" },
  friendship: { displayName: "FRIENDSHIP", icon: "👫", type: "stat" },
  respect: { displayName: "RESPECT", icon: "🙏", type: "stat" },
  loyalty: { displayName: "LOYALTY", icon: "🤝", type: "stat" },
  
  // RPG-style stats
  strength: { displayName: "STRENGTH", icon: "💪", type: "stat" },
  dexterity: { displayName: "DEXTERITY", icon: "🤸", type: "stat" },
  intelligence: { displayName: "INTELLIGENCE", icon: "🧠", type: "stat" },
  wisdom: { displayName: "WISDOM", icon: "🦉", type: "stat" },
  charisma: { displayName: "CHARISMA", icon: "✨", type: "stat" },
  constitution: { displayName: "CONSTITUTION", icon: "🛡️", type: "stat" },
  
  // Generic numeric stats
  points: { displayName: "POINTS", icon: "⭐", type: "stat" },
  score: { displayName: "SCORE", icon: "🎯", type: "stat" },
  rating: { displayName: "RATING", icon: "⭐", type: "stat" },
};

/**
 * Generate display information for a field based on its key and value
 * @param {string} fieldKey - The field key from the JSON data
 * @param {*} fieldValue - The field value from the JSON data
 * @param {Object} characterData - The character data to check for custom icons
 * @param {Object} worldData - The world data to check for shared custom icons
 * @returns {Object} Display information with displayName, icon, type, etc.
 */
const generateFieldMapping = (fieldKey, fieldValue, characterData = {}, worldData = {}) => {
  // Check if we have a predefined mapping
  let mapping = DEFAULT_FIELD_MAPPING[fieldKey] ? 
    { ...DEFAULT_FIELD_MAPPING[fieldKey], key: fieldKey } : null;
  
  // Check for custom icon in the data - supports multiple naming conventions
  let customIcon = null;
  const iconKeys = [
    `${fieldKey}Icon`,           // apIcon
    `${fieldKey}_icon`,          // ap_icon
    `${fieldKey}.icon`,          // ap.icon (if passed as key)
    `icon_${fieldKey}`,          // icon_ap
    `icons.${fieldKey}`,         // icons.ap (if passed as key)
  ];
  
  // First check character-specific icons object
  if (characterData.icons && typeof characterData.icons === 'object' && characterData.icons[fieldKey]) {
    customIcon = characterData.icons[fieldKey];
  }
  // Then check worldData icons object for shared icons
  else if (worldData.icons && typeof worldData.icons === 'object' && worldData.icons[fieldKey]) {
    customIcon = worldData.icons[fieldKey];
  }
  // Finally check character-specific icon keys
  else {
    // Check each possible icon key in character data
    for (const iconKey of iconKeys) {
      if (characterData[iconKey]) {
        customIcon = characterData[iconKey];
        break;
      }
    }
  }
  
  // If we have a predefined mapping, use it as base but allow icon override
  if (mapping) {
    if (customIcon) {
      mapping.icon = customIcon;
    }
    return mapping;
  }
  
  // Generate mapping based on field key patterns and value types
  const key = fieldKey.toLowerCase();
  let displayName = fieldKey.toUpperCase().replace(/_/g, ' ');
  let icon = "📊"; // Default icon
  let type = "stat";
  
  // Pattern-based mapping
  if (key.includes("change") || key.includes("delta")) {
    icon = "📈";
    type = "change";
  } else if (key.includes("status") || key.includes("state")) {
    icon = "ℹ️";
    type = "status";
  } else if (key.includes("thought") || key.includes("think")) {
    icon = "💭";
    type = "thought";
  } else if (key.includes("date") || key.includes("time")) {
    icon = "📅";
    type = "date";
  } else if (key.includes("color") || key.includes("bg") || key.includes("background")) {
    icon = "🎨";
    type = "color";
  } else if (key.includes("health") || key.includes("hp")) {
    icon = "💚";
    type = "stat";
  } else if (key.includes("energy") || key.includes("stamina")) {
    icon = "🔋";
    type = "stat";
  } else if (key.includes("love") || key.includes("romance")) {
    icon = "💕";
    type = "stat";
  } else if (key.includes("anger") || key.includes("rage")) {
    icon = "😡";
    type = "stat";
  } else if (key.includes("fear") || key.includes("scared")) {
    icon = "😨";
    type = "stat";
  } else if (key.includes("happy") || key.includes("joy")) {
    icon = "😄";
    type = "stat";
  } else if (key.includes("sad") || key.includes("sorrow")) {
    icon = "😢";
    type = "stat";
  } else if (key.includes("stress") || key.includes("anxiety")) {
    icon = "😰";
    type = "stat";
  } else if (key.includes("trust") || key.includes("faith")) {
    icon = "🤝";
    type = "stat";
  } else if (key.includes("desire") || key.includes("lust") || key.includes("arousal")) {
    icon = "🔥";
    type = "stat";
  } else if (key.includes("friend") || key.includes("buddy")) {
    icon = "👫";
    type = "stat";
  } else if (key.includes("respect") || key.includes("honor")) {
    icon = "🙏";
    type = "stat";
  } else if (key.includes("level") || key.includes("lvl")) {
    icon = "⭐";
    type = "stat";
  } else if (key.includes("xp") || key.includes("experience") || key.includes("exp")) {
    icon = "⚡";
    type = "stat";
  } else if (key.includes("strength") || key.includes("str")) {
    icon = "💪";
    type = "stat";
  } else if (key.includes("intelligence") || key.includes("int") || key.includes("smart")) {
    icon = "🧠";
    type = "stat";
  } else if (key.includes("wisdom") || key.includes("wis")) {
    icon = "🦉";
    type = "stat";
  } else if (key.includes("charisma") || key.includes("cha") || key.includes("charm")) {
    icon = "✨";
    type = "stat";
  } else if (key.includes("dexterity") || key.includes("dex") || key.includes("agility")) {
    icon = "🤸";
    type = "stat";
  } else if (key.includes("constitution") || key.includes("con") || key.includes("endurance")) {
    icon = "🛡️";
    type = "stat";
  }
  
  // Type-based detection from value
  if (typeof fieldValue === 'boolean') {
    type = "boolean";
    icon = fieldValue ? "✅" : "❌";
  } else if (typeof fieldValue === 'string' && fieldValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
    type = "date";
    icon = "📅";
  } else if (typeof fieldValue === 'string' && fieldValue.match(/^#[0-9A-Fa-f]{6}$/)) {
    type = "color";
    icon = "🎨";
  }
  
  return {
    key: fieldKey,
    displayName,
    icon: customIcon || icon, // Use custom icon if provided, otherwise use default/pattern-based icon
    type,
    maxValue: typeof fieldValue === 'number' ? Math.max(100, fieldValue * 1.2) : undefined
  };
};

/**
 * Extract and map all stat fields from character data
 * @param {Object} characterStats - The character's stats object
 * @param {Object} worldData - The world data object for shared icons
 * @returns {Array} Array of field mappings for displayable stats
 */
const extractDisplayableFields = (characterStats, worldData = {}) => {
  const fields = [];
  const excludedFields = new Set([
    'name', 'internal_thought', 'thought', 'relationshipStatus', 'desireStatus', 
    'inactive', 'inactiveReason', 'bg', 'health', 'last_react', 'preg', 
    'conception_date', 'days_preg'
  ]);
  
  // Process all numeric and change fields for the stats display
  Object.keys(characterStats).forEach(key => {
    const value = characterStats[key];
    
    // Skip fields that end with "Change" as they are change indicators, not displayable stats
    if (key.endsWith('Change')) {
      return;
    }
    
    // Skip icon fields - they're metadata, not stats to display
    if (key.endsWith('Icon') || key.endsWith('_icon') || key.startsWith('icon_') || key === 'icons') {
      return;
    }

    // Skip "hidden" fields
    if (key.endsWith("Hidden")) {
      return;
    }
    
    // Only include fields that are numeric stats
    if (!excludedFields.has(key) && (typeof value === 'number' || value === "?")) {
      const mapping = generateFieldMapping(key, value, characterStats, worldData);
      if (mapping.type === 'stat') {
        fields.push({
          ...mapping,
          value: value,
          changeValue: characterStats[key + 'Change'] || 0
        });
      }
    }
  });
  
  // Sort fields by importance (predefined fields first, then alphabetically)
  fields.sort((a, b) => {
    const aPredefined = DEFAULT_FIELD_MAPPING[a.key] ? 0 : 1;
    const bPredefined = DEFAULT_FIELD_MAPPING[b.key] ? 0 : 1;
    
    if (aPredefined !== bPredefined) {
      return aPredefined - bPredefined;
    }
    
    return a.displayName.localeCompare(b.displayName);
  });
  
  return fields;
};

/**
 * Generate dynamic stats HTML for a character
 * @param {Array} fields - Array of field mappings
 * @returns {string} HTML string for the stats section
 */
const generateDynamicStatsHtml = (fields) => {
  if (!fields || fields.length === 0) {
    return '<div class="no-stats">No stats available</div>';
  }
  
  return fields.map(field => {
    const changeHtml = field.changeValue && field.changeValue !== 0 ? 
      `<div class="change-indicator ${field.changeValue > 0 ? 'positive' : 'negative'}">
        ${field.changeValue > 0 ? '+' : ''}${field.changeValue}
      </div>` : '';
    
    return `
      <div class="stat-item">
        <div class="stat-title">${field.displayName}</div>
        <div class="stat-container">
          <div class="stat-icon">${field.icon}</div>
          <div class="stat-value">${field.value}</div>
          ${changeHtml}
        </div>
      </div>
    `;
  }).join('');
};

export {
  DEFAULT_FIELD_MAPPING,
  generateFieldMapping,
  extractDisplayableFields,
  generateDynamicStatsHtml
};