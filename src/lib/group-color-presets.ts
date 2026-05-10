/**
 * Fixed palette for group accents — hues spread ~36° apart so glows read
 * clearly (avoids indigo / blue / violet clusters).
 */
export const GROUP_COLOR_PRESETS: readonly string[] = [
  "#c62828", // deep red
  "#ef6c00", // orange
  "#f9a825", // amber / yellow
  "#558b2f", // olive
  "#00796b", // teal
  "#0277bd", // bright blue (only one blue family)
  "#ad1457", // magenta / pink
  "#4527a0", // deep purple (well separated from blue in hue + blur)
  "#4e342e", // brown
  "#37474f", // blue-grey (low chroma; reads as neutral frame)
];
