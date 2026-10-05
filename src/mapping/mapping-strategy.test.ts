import type { MappingStrategy } from "./mapping-strategy.js";

function assertStrategy(strategy: MappingStrategy): void {
  console.log(`Valid mapping strategy: ${strategy}`);
}

function main(): void {
  assertStrategy("exact-id");
  assertStrategy("exact-path");
  assertStrategy("name-and-parent");

  console.log("Mapping strategy test passed.");
}

main();
