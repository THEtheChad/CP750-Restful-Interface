import { useId, useMemo, useState } from "react";
import { useCommands, useDevice, useToken } from "../../api/hooks.ts";
import controls from "../../styles/controls.module.css";
import { ProblemMessage } from "../ProblemMessage/ProblemMessage.tsx";
import styles from "./Advanced.module.css";
import { ParamGroup } from "./components/ParamGroup/ParamGroup.tsx";
import { filterCommands, groupByNamespace, NAMESPACE_LABELS, namespacesOf } from "./filter.ts";

/**
 * Every parameter of the active manifest, grouped by namespace, with search. Values are read
 * lazily: a row reads its value once it has been on screen for a moment, or on demand.
 */
export function Advanced() {
  const commandsQuery = useCommands();
  const { data: device } = useDevice();
  const token = useToken();
  const context = useMemo(() => ({ device, hasToken: token !== null }), [device, token]);
  const [query, setQuery] = useState("");
  const [namespace, setNamespace] = useState("all");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const headingId = useId();
  const searchId = useId();
  const namespaceId = useId();

  const all = commandsQuery.data?.commands ?? [];
  const namespaces = useMemo(() => namespacesOf(all), [all]);
  const filtered = useMemo(() => filterCommands(all, query, namespace), [all, query, namespace]);
  const groups = useMemo(() => groupByNamespace(filtered), [filtered]);
  const filtering = query.trim() !== "" || namespace !== "all";

  const toggle = (ns: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns);
      else next.add(ns);
      return next;
    });

  return (
    <section className={styles.advanced} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        All parameters
      </h2>
      {/* biome-ignore lint/a11y/useSemanticElements: <search> is too new for older booth PCs' browsers. */}
      <div className={styles.toolbar} role="search">
        <div className={`${styles.field} ${styles.search}`}>
          <label htmlFor={searchId}>Search</label>
          <input
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
        <p className={styles.count} aria-live="polite">
          {filtering
            ? `${filtered.length} of ${all.length} parameters`
            : `${all.length} parameters`}
        </p>
      </div>
      <p className={styles.hint}>
        Values are read from the processor only for parameters on screen, or when you press Read.
      </p>
      <ProblemMessage error={commandsQuery.error} />
      {commandsQuery.isSuccess && all.length === 0 && (
        <p>No parameters yet: the gateway hasn't identified the processor's firmware.</p>
      )}
      {filtering && filtered.length === 0 && all.length > 0 && <p>No parameters match.</p>}
      <div className={styles.groups}>
        {groups.map((g) => (
          <ParamGroup
            key={g.namespace}
            namespace={g.namespace}
            label={NAMESPACE_LABELS[g.namespace] ?? g.namespace}
            commands={g.commands}
            context={context}
            expanded={filtering || expanded.has(g.namespace)}
            {...(filtering ? {} : { onToggle: () => toggle(g.namespace) })}
          />
        ))}
      </div>
    </section>
  );
}
