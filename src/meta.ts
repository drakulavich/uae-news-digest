type PackageMetadata = {
  name: string;
  version: string;
  bin?: Record<string, string>;
};

const packageJson = await Bun.file(new URL('../package.json', import.meta.url)).json() as PackageMetadata;

export const TOOL_ID = 'uae-news-digest';
export const VERSION = packageJson.version;
export const BIN_NAME = Object.keys(packageJson.bin ?? {})[0] ?? TOOL_ID;
