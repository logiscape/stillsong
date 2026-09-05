export function Panel({children,variant="matte",pad="var(--gutter-panel)",style,...rest}){
  const skin={
    matte:{background:"var(--surface-card)",border:"1px solid var(--border-hairline)",boxShadow:"var(--shadow-2)"},
    inset:{background:"var(--surface-inset)",border:"1px solid var(--border-hairline)",boxShadow:"var(--inset-field)"},
    glass:{background:"var(--panel-blur-bg)",backdropFilter:"var(--panel-blur)",border:"1px solid var(--line-1)",boxShadow:"var(--shadow-3)"},
    solid:{background:"var(--panel-solid-bg)",border:"1px solid var(--line-2)",boxShadow:"var(--shadow-3)"},
    quiet:{background:"transparent",border:"1px solid var(--border-hairline)"}
  }[variant];
  return <div style={{borderRadius:"var(--radius-lg)",padding:pad,...skin,...style}} {...rest}>{children}</div>;
}
