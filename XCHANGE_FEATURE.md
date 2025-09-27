# Data Synchronization Feature

## Overview

The SillyTavern SimTracker extension supports automatic synchronization of character data to persistent app-data variables. This feature allows you to maintain persistent character states across conversations, supporting both direct value assignments and incremental changes.

## How It Works

### 1. Enable Data Sync
Add a boolean flag to any character in your sim data to enable synchronization:
- `enableDataSync: true`
- `dataSync: true` 
- `syncData: true`
- `trackChanges: true`

### 2. Synchronization Modes

The system operates in three modes based on the data provided:

**Mode 1: Direct Value Assignment**
When a regular data key is present (e.g., `ap`, `items`, `skills`), the system sets the global variable to the exact value provided:
- `ap: 75` → Sets `CharacterName_ap` to 75
- `items: ["Sword", "Shield"]` → Sets `CharacterName_items` to that exact list
- Overwrites any existing stored value

**Mode 2: Change-Only Processing**  
When a `Change` key is present but its base key is NOT present, the system applies the change to the stored value:
- `apChange: 5` (no `ap` key) → Adds 5 to stored `CharacterName_ap`
- `itemsChange: {add: ["Potion"]}` (no `items` key) → Adds "Potion" to stored list

**Mode 3: Change Ignored**
When both the base key and change key are present, only the direct assignment is processed:
- `ap: 80, apChange: 5` → Sets `CharacterName_ap` to 80, ignores the change

### 3. Variable Storage
Changes are stored in global variables with the pattern: `{CharacterName}_{StatName}`

Examples:
- `Alice_ap`: Alice's accumulated affection changes
- `Bob_dp`: Bob's accumulated desire changes
- `Carol_customStat`: Carol's accumulated custom stat changes

## Usage Examples

### Mode 1: Direct Value Assignment
```json
{
  "cards": [
    {
      "name": "Alice",
      "ap": 85,
      "items": ["New Sword", "Magic Shield"],
      "level": 15,
      "enableDataSync": true
    }
  ]
}
```

Results:
- `Alice_ap` set to exactly 85 (overwrites any previous value)
- `Alice_items` set to exactly `["New Sword", "Magic Shield"]`
- `Alice_level` set to 15

### Mode 2: Change-Only Processing
```json
{
  "cards": [
    {
      "name": "Alice",
      "apChange": 5,
      "itemsChange": {
        "add": ["Magic Ring"],
        "remove": ["Old Sword"]
      },
      "enableDataSync": true
    }
  ]
}
```

Results (assuming stored values exist):
- `Alice_ap` increased by 5 from its stored value
- "Magic Ring" added to stored `Alice_items` list
- "Old Sword" removed from stored `Alice_items` list

### Mode 3: Mixed (Change Ignored)
```json
{
  "cards": [
    {
      "name": "Alice",
      "ap": 80,
      "apChange": 5,
      "items": ["Sword", "Shield"],
      "itemsChange": {
        "add": ["Ignored Item"]
      },
      "enableDataSync": true
    }
  ]
}
```

Results:
- `Alice_ap` set to exactly 80 (apChange ignored)
- `Alice_items` set to exactly `["Sword", "Shield"]` (itemsChange ignored)

### Practical Usage
```json
{
  "cards": [
    {
      "name": "Alice",
      // Set new absolute values
      "ap": 75,
      "level": 12,
      // Apply changes to values not directly specified
      "goldChange": 50,
      "itemsChange": {
        "add": ["Health Potion"],
        "remove": ["Broken Sword"]
      },
      "enableDataSync": true
    }
  ]
}
```

This allows you to set some values directly while applying incremental changes to others.

## Technical Details

### When Processing Occurs
- Only when `withSim` is true (during live sim data processing)
- Not during refreshes or re-renders without new sim data
- After sim data parsing but before rendering
- Data sync processing happens first, then backfill of missing keys

### Processing Order
1. **Direct Assignment**: Set global variables for all direct value keys (e.g., `ap`, `items`)
2. **Change Processing**: Apply `Change` keys only when their base key is not present
3. **Backfill**: Populate missing base keys from updated global variables
4. **Render**: Display cards with complete data including backfilled values

### Variable Initialization
**Numeric Variables:**
- Variables start at 0 if they don't exist
- Changes accumulate over time
- Negative values are supported

**List Variables:**
- Variables start as empty arrays `[]` if they don't exist
- Stored as JSON strings in global variables
- Automatically parsed and re-serialized
- Duplicate prevention on additions
- Graceful handling of non-existent removals

### Excluded Keys
The following keys are never synchronized to avoid interfering with display logic:
- `bg`, `bgColor` - Styling keys
- `inactive`, `inactiveReason` - Display state keys  
- `internal_thought`, `thought` - Thought display keys
- `relationshipStatus`, `desireStatus` - Status display keys
- `last_react`, `health` - Reaction/health display keys
- `enableDataSync`, `dataSync`, `syncData`, `trackChanges` - Sync control keys

### Error Handling
**Direct Assignment:**
- Invalid values (null/undefined) are skipped
- Arrays are automatically JSON-serialized for storage
- All errors are logged without breaking rendering

**Change Processing:**
- Invalid change values (non-numbers) are ignored
- Zero numeric changes are ignored
- Invalid list data is handled gracefully
- All errors are logged without breaking rendering

## Automatic Key Backfill

When an `xChange` key is present but the corresponding base key is missing, the system will automatically retrieve the value from the global variable and populate it in the rendered data.

### Example
```json
{
  "name": "Alice",
  "apChange": -1,
  // No "ap" key provided
  "enableDataSync": true
}
```

The system will:
1. Apply the change: `Alice_ap` variable gets decreased by 1
2. Backfill the missing key: Set `ap` in the character data to the updated `Alice_ap` value
3. Render with the complete data showing both the current value and the change

This ensures the tracker cards always display complete information even when only changes are provided.

## Integration

The feature is automatically enabled and requires no configuration. It integrates seamlessly with the existing SimTracker rendering pipeline and uses SillyTavern's global variable system for persistent storage.

## Access Stored Data

You can access the accumulated data using SillyTavern's variable system:

**Numeric Variables:**
- In prompts: `{{getglobalvar::Alice_ap}}`
- In scripts: `getGlobalVariable("Alice_ap")`
- Via the `/getglobalvar` slash command

**List Variables:**
- In prompts: `{{getglobalvar::Alice_items}}` (returns JSON string)
- In scripts: `JSON.parse(getGlobalVariable("Alice_items") || "[]")`
- Via the `/getglobalvar` slash command (returns JSON string)

**Example List Access in Prompts:**
```
Alice's current items: {{getglobalvar::Alice_items}}
```
This would output: `["Big Hat", "Pointed Stick", "Magic Amulet"]`