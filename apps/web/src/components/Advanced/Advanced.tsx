import { useId, useMemo, useRef, useState } from "react";
import { useCommands, useDevice, useToken } from "../../api/hooks.ts";
import controls from "../../styles/controls.module.css";
import { Icon } from "../Icon/Icon.tsx";
import { ProblemMessage } from "../ProblemMessage/ProblemMessage.tsx";
import styles from "./Advanced.module.css";
import { ParamGroup } from "./components/ParamGroup/ParamGroup.tsx";
import {
  filterCommands,
  groupCommands,
  inScope,
  NAMESPACE_LABELS,
  namespacesOf,
  primaryOp,
  SCOPES,
  type Scope,
} from "./filter.ts";

const SCOPE_LABELS: Record<Scope, string> = {
  available: "Available",
  locked: "Locked",
  all: "All",
};

/**
 * Every parameter of the active manifest, grouped (by namespace; `sys` by what its params do, the
 * equalizer per channel), with search and a scope
 * (Available / Locked / All; Available by default, so the full-set params the gateway refuses
 * don't bury the ones that can be used). Values are read lazily: a row reads its value once it has
 * been on screen for a moment, or on demand.
 */
export function Advanced() {
  const commandsQuery = useCommands();
  const { data: device } = useDevice();
  const token = useToken();
  const context = useMemo(() => ({ device, hasToken: token !== null }), [device, token]);
  const [query, setQuery] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [scope, setScope] = useState<Scope>("available");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const headingId = useId();
  const searchId = useId();
  const namespaceId = useId();
  const scopeName = useId();

  const all = commandsQuery.data?.commands ?? [];
  const namespaces = useMemo(() => namespacesOf(all), [all]);
  const counts = useMemo(
    () =>
      Object.fromEntries(SCOPES.map((s) => [s, all.filter((c) => inScope(c, s)).length])) as Record<
        Scope,
        number
      >,
    [all],
  );
  const fullTier = useMemo(
    () => all.filter((c) => c.blocked[primaryOp(c)] === "full-tier").length,
    [all],
  );
  const filtered = useMemo(
    () => filterCommands(all, query, namespace, scope),
    [all, query, namespace, scope],
  );
  const matchesAnyScope = useMemo(
    () => (scope === "all" ? filtered.length : filterCommands(all, query, namespace).length),
    [all, query, namespace, scope, filtered.length],
  );
  const groups = useMemo(() => groupCommands(filtered), [filtered]);
  const filtering = query.trim() !== "" || namespace !== "all";
  const outOfScope = matchesAnyScope - filtered.length;

  const toggle = (ns: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });

  const clearFilters = () => {
    setQuery("");
    setNamespace("all");
    searchRef.current?.focus();
  };

  return (
    <section className={styles.advanced} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 className={styles.heading} id={headingId}>
          All parameters
        </h2>
        <p className={styles.count} aria-live="polite">
          {filtered.length === all.length
            ? `${all.length} parameters`
            : `${filtered.length} of ${all.length} parameters`}
        </p>
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: <search> is too new for older booth PCs' browsers. */}
      <div className={styles.toolbar} role="search">
        <div className={`${styles.field} ${styles.search}`}>
          <label htmlFor={searchId}>Search</label>
          <input
            ref={searchRef}
            id={searchId}
            className={controls.field}
            type="search"
            placeholder="Name, alias or description"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={namespaceId}>Namespace</label>
          <select
            id={namespaceId}
            className={controls.field}
            value={namespace}
            onChange={(e) => setNamespace(e.target.value)}
          >
            <option value="all">All ({all.length})</option>
            {namespaces.map((n) => (
              <option key={n.namespace} value={n.namespace}>
                {NAMESPACE_LABELS[n.namespace] ?? n.namespace} ({n.count})
              </option>
            ))}
          </select>
        </div>
        <fieldset className={styles.scope}>
          <legend>Show</legend>
          <div className={styles.segments}>
            {SCOPES.map((s) => (
              <label key={s} className={styles.segment}>
                <input
                  type="radio"
                  name={scopeName}
                  value={s}
                  checked={scope === s}
                  onChange={() => setScope(s)}
                />
                <span>
                  {SCOPE_LABELS[s]} <span className={styles.segmentCount}>{counts[s]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {fullTier > 0 && (
        <p className={styles.notice} data-notice="full-tier">
          <Icon name="lock" className={styles.noticeIcon} />
          <span>
            {scope === "available"
              ? `${fullTier} parameters are hidden because they need the CP750's full command set. `
              : `${fullTier} parameters need the CP750's full command set. `}
            Start the gateway with <code>CP750_ALLOW_FULL=1</code> to use them.
          </span>
          {scope === "available" && (
            <button
              type="button"
              className={`${controls.button} ${controls.small}`}
              onClick={() => setScope("locked")}
            >
              Show locked
            </button>
          )}
        </p>
      )}
      <p className={styles.hint}>
        Values are read from the processor when a row is on screen, or when you press Read.
      </p>

      <ProblemMessage error={commandsQuery.error} />
      {commandsQuery.isSuccess && all.length === 0 && (
        <p className={styles.empty}>
          No parameters yet: the gateway hasn't identified the processor's firmware.
        </p>
      )}
      {all.length > 0 && filtered.length === 0 && (
        <div className={styles.empty}>
          <p>
            {filtering
              ? query.trim()
                ? `No ${scope === "all" ? "" : `${SCOPE_LABELS[scope].toLowerCase()} `}parameters match “${query.trim()}”.`
                : "No parameters in this namespace."
              : `No ${SCOPE_LABELS[scope].toLowerCase()} parameters.`}
          </p>
          {filtering && (
            <button
              type="button"
              className={`${controls.button} ${controls.small}`}
              onClick={clearFilters}
            >
              Clear search
            </button>
          )}
        </div>
      )}
      {outOfScope > 0 && filtering && (
        <p className={styles.more}>
          {outOfScope} more {outOfScope === 1 ? "match is" : "matches are"}{" "}
          {scope === "available" ? "locked" : "available"}.{" "}
          <button type="button" className={styles.link} onClick={() => setScope("all")}>
            Show all
          </button>
        </p>
      )}

      <div className={styles.groups}>
        {groups.map((g) => (
          <ParamGroup
            key={g.key}
            prefix={g.prefix}
            label={g.label}
            commands={g.commands}
            context={context}
            expanded={filtering || expanded.has(g.key)}
            {...(filtering ? {} : { onToggle: () => toggle(g.key) })}
          />
        ))}
      </div>
    </section>
  );
}
