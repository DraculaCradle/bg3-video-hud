// Foundry V14's published client declares Chromium 146 as its minimum.
export function requireFoundryChromium(version) {
  const match = /^(\d+)\.\d+\.\d+\.\d+$/.exec(version);
  if (!match || Number(match[1]) < 146) {
    throw Error('Chromium 146 or newer required; stopped before Foundry login');
  }
  return version;
}
