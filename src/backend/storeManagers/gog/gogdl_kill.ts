/**
 * Linux `pkill -f` treats the pattern as a regex against every process
 * command line. A bare GOG product id (digits) matches unrelated programs
 * whose args happen to contain that number. Require the gogdl binary name.
 */
export function gogdlProcessPattern(appName: string): string {
  const id = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return `gogdl.*${id}`
}
