import packageJson from '../package.json';

export const TOOL_ID = 'uae-news-digest';
export const VERSION: string = packageJson.version;
export const BIN_NAME: string = Object.keys(packageJson.bin ?? {})[0] ?? TOOL_ID;
export const DESCRIPTION: string = packageJson.description;
