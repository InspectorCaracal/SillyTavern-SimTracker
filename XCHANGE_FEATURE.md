# xChange Data Synchronization Feature

## Overview

The SillyTavern SimTracker extension now supports automatic synchronization of character statistics changes to persistent app-data variables. This feature allows you to track cumulative changes to character stats across conversations.

## How It Works

### 1. Enable Data Sync
Add a boolean flag to any character in your sim data to enable synchronization:
- `enableDataSync: true`
- `dataSync: true` 
- `syncData: true`
- `trackChanges: true`

### 2. xChange Keys
Any key ending with "Change" will be processed:

**Numeric Changes:**
- `apChange`: Affection point changes
- `dpChange`: Desire point changes  
- `tpChange`: Trust point changes
- `cpChange`: Contempt point changes
- `customStatChange`: Any custom stat changes

**List Modifications:**
- `itemsChange`: Inventory item changes
- `skillsChange`: Skill list changes
- `traitsChange`: Character trait changes
- `anyListChange`: Any list-based data changes

### 3. Variable Storage
Changes are stored in global variables with the pattern: `{CharacterName}_{StatName}`

Examples:
- `Alice_ap`: Alice's accumulated affection changes
- `Bob_dp`: Bob's accumulated desire changes
- `Carol_customStat`: Carol's accumulated custom stat changes

## Usage Examples

### Numeric Changes
```json
{
  "worldData": {
    "current_date": "2025-09-26",
    "current_time": "14:30"
  },
  "cards": [
    {
      "name": "Alice",
      "ap": 75,
      "dp": 60,
      "apChange": 5,
      "dpChange": -2,
      "enableDataSync": true
    },
    {
      "name": "Bob",
      "ap": 45,
      "dp": 30,
      "apChange": 3,
      "dpChange": 1
      // No sync flag - changes will not be tracked
    }
  ]
}
```

Results:
- Alice's affection will increase the `Alice_ap` variable by 5
- Alice's desire will decrease the `Alice_dp` variable by 2  
- Bob's changes will be ignored (no sync flag)

### List Modifications
```json
{
  "cards": [
    {
      "name": "Alice",
      "itemsChange": {
        "add": ["Pointed Stick", "Magic Amulet"],
        "remove": ["Fancy Shoes", "Big Hat"]
      },
      "skillsChange": {
        "add": ["Swimming"],
        "remove": ["Dancing"]
      },
      "enableDataSync": true
    }
  ]
}
```

Results:
- `Alice_items` list will have "Pointed Stick" and "Magic Amulet" added
- `Alice_items` list will have "Fancy Shoes" and "Big Hat" removed
- `Alice_skills` list will have "Swimming" added and "Dancing" removed
- Duplicate additions are ignored
- Removing non-existent items is handled gracefully

### Combined Example with Backfill
```json
{
  "cards": [
    {
      "name": "Alice",
      // Only changes provided - base values will be backfilled
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

Processing flow:
1. **Data Sync**: `Alice_ap` variable increased by 5, `Alice_items` updated
2. **Backfill**: `ap` and `items` keys added to character data from stored variables
3. **Display**: Card shows current AP value and current items list, plus change indicators

## Technical Details

### When Processing Occurs
- Only when `withSim` is true (during live sim data processing)
- Not during refreshes or re-renders without new sim data
- After sim data parsing but before rendering
- Data sync processing happens first, then backfill of missing keys

### Processing Order
1. **Data Sync**: Apply all `xChange` modifications to global variables
2. **Backfill**: Populate missing base keys from updated global variables  
3. **Render**: Display cards with complete data including backfilled values

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

### Error Handling
**Numeric Changes:**
- Invalid change values (non-numbers) are ignored
- Zero changes are ignored (no variable updates)
- Errors are logged to console without breaking rendering

**List Changes:**
- Invalid list data is handled gracefully
- Malformed existing data is reset to empty array
- Missing `add` or `remove` arrays are ignored
- Non-array values in `add`/`remove` are ignored
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