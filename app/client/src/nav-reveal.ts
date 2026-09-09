/**
 * Whether every tab is drawn for every reader, whatever their role.
 *
 * OFF IN PRODUCTION. The flag remains as an explicit review posture, but ADAPT
 * ships the role checks: consumers see Ask, while administrators also see the
 * operational surfaces and settings.
 *
 * WHAT IT DOES NOT DO, which matters more than what it does:
 *
 *  - It does not widen permission. The server refuses every admin route with
 *    403 whatever this draws, and that refusal is the enforcement. Nothing here
 *    reaches the server, is sent to it, or is agreed with it.
 *  - It does not open the admin pages. `AdminOnly` still stands in front of
 *    Monitoring, Ops and App settings, so a genuine consumer who follows one of
 *    these newly-visible tabs is met by the gate panel -- "Not available on your
 *    account", one line naming the page, and the way back -- rather than by a
 *    page of failed requests. That panel is the reason unhiding the tabs is
 *    safe to do from the navigation alone.
 *
 * Here rather than in `shared/` because the server must NOT agree with it. That
 * is the opposite of `ACCESS_GATE_ENABLED`, which is in `shared/` precisely
 * because it is deployment state both halves have to read the same way. Here
 * rather than in `experimental-features.ts` because that file is a per-browser
 * preference a reader sets for themselves, and this is a posture for the
 * deployment that no reader should be able to turn off.
 */
export const SHOW_EVERY_TAB_TO_EVERYONE: boolean = false;

/**
 * Whether the Benchmark Lab is offered in the app at all.
 *
 * OFF. This app's audience is data analysts, who benchmark nothing here, so the
 * Benchmark Lab is withdrawn from the product surface: no Benchmarking tab, no
 * Settings toggle to turn it on, and `/benchmarks` redirects to Ask. The server
 * `/api/benchmarks*` routes stay registered and dormant, and this flag is UI
 * visibility only, so the surface can be restored by flipping this one boolean
 * without a migration or any data change.
 *
 * Read by `role.ts` (the nav tabs), `BenchmarkingVisibility` (the route) and
 * `SettingsPage` (the toggle), so all three withdraw together and a pasted
 * `/benchmarks` URL cannot reach a lab the navigation is hiding.
 */
export const BENCHMARK_LAB_ENABLED: boolean = false;
