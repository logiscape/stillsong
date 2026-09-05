/* @ds-bundle: {"format":4,"namespace":"StillsongDesignSystem_4faa75","components":[{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Icon","sourcePath":"components/core/Icon.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Panel","sourcePath":"components/core/Panel.jsx"},{"name":"Dialog","sourcePath":"components/feedback/Dialog.jsx"},{"name":"LintList","sourcePath":"components/feedback/LintList.jsx"},{"name":"Notice","sourcePath":"components/feedback/Notice.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"CREATION_STAGES","sourcePath":"components/feedback/StageList.jsx"},{"name":"StageList","sourcePath":"components/feedback/StageList.jsx"},{"name":"Disclosure","sourcePath":"components/forms/Disclosure.jsx"},{"name":"SegmentedChoice","sourcePath":"components/forms/SegmentedChoice.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"},{"name":"LyricSheet","sourcePath":"components/media/LyricSheet.jsx"},{"name":"PhotoRoom","sourcePath":"components/media/PhotoRoom.jsx"},{"name":"PhotoWell","sourcePath":"components/media/PhotoWell.jsx"},{"name":"Player","sourcePath":"components/media/Player.jsx"},{"name":"SongCard","sourcePath":"components/media/SongCard.jsx"}],"sourceHashes":{"components/core/Badge.jsx":"bdf4a8f92ae7","components/core/Button.jsx":"ec4d213bc0b3","components/core/Icon.jsx":"15c73cf3114d","components/core/IconButton.jsx":"ba44f8e200d1","components/core/Panel.jsx":"85cdf2b6eab0","components/feedback/Dialog.jsx":"6575bd2f7c46","components/feedback/LintList.jsx":"90c5cd3fb845","components/feedback/Notice.jsx":"75e1d36f8e73","components/feedback/ProgressBar.jsx":"fe8d401f3960","components/feedback/StageList.jsx":"553107188711","components/forms/Disclosure.jsx":"4686acdac746","components/forms/SegmentedChoice.jsx":"8dbe774065d1","components/forms/Select.jsx":"8f3f5d627d42","components/forms/Switch.jsx":"020db28fcda0","components/forms/TextField.jsx":"0a5d50db58f1","components/media/LyricSheet.jsx":"d9fed65e8bbf","components/media/PhotoRoom.jsx":"406ce29bfde6","components/media/PhotoWell.jsx":"07297ee2af03","components/media/Player.jsx":"0e3b945c494c","components/media/SongCard.jsx":"04b8336c0d89","ui_kits/stillsong-app/AppFrame.jsx":"d4931abf7c3c","ui_kits/stillsong-app/CreateScreen.jsx":"4c1c0ae06e90","ui_kits/stillsong-app/FirstRunScreen.jsx":"16ae348f4ed5","ui_kits/stillsong-app/RemixScreen.jsx":"a56bf59b220c","ui_kits/stillsong-app/SanctuaryScreen.jsx":"81ef3052c449","ui_kits/stillsong-app/SettingsScreen.jsx":"81cd6c98eab1","ui_kits/stillsong-app/SongScreen.jsx":"ccddf076bda8","ui_kits/stillsong-app/data.jsx":"93caf6e4050b"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.StillsongDesignSystem_4faa75 = window.StillsongDesignSystem_4faa75 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Icon.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const LUCIDE_BASE = "https://unpkg.com/lucide-static@0.454.0/icons/";

/* Lucide geometry loaded as a CSS mask so it inherits currentColor.
   No hand-drawn paths anywhere in this design system. */
function Icon({
  name,
  size = 18,
  color = "currentColor",
  style,
  title,
  ...rest
}) {
  const url = `url("${LUCIDE_BASE}${name}.svg")`;
  return /*#__PURE__*/React.createElement("span", _extends({
    role: title ? "img" : "presentation",
    "aria-label": title,
    "aria-hidden": title ? undefined : true,
    style: {
      display: "inline-block",
      flex: "0 0 auto",
      width: size,
      height: size,
      background: color,
      WebkitMaskImage: url,
      maskImage: url,
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      maskPosition: "center",
      WebkitMaskSize: "contain",
      maskSize: "contain",
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Icon });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Icon.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Badge({
  children,
  tone = "neutral",
  icon,
  mono,
  style,
  ...rest
}) {
  const tones = {
    neutral: {
      background: "var(--wash-1)",
      color: "var(--ink-2)",
      border: "1px solid var(--line-1)"
    },
    brass: {
      background: "var(--brass-wash)",
      color: "var(--brass-200)",
      border: "1px solid var(--brass-line)"
    },
    glass: {
      background: "rgba(12,11,10,.5)",
      color: "var(--ink-1)",
      border: "1px solid var(--line-2)",
      backdropFilter: "var(--blur-chrome)"
    },
    sage: {
      background: "var(--sage-wash)",
      color: "#A6BE9D",
      border: "1px solid rgba(127,154,118,.4)"
    },
    amber: {
      background: "var(--amber-wash)",
      color: "#E6BC76",
      border: "1px solid rgba(206,155,69,.4)"
    },
    clay: {
      background: "var(--clay-wash)",
      color: "#E0A18B",
      border: "1px solid rgba(180,102,76,.42)"
    }
  };
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 24,
      padding: "0 10px",
      borderRadius: "var(--radius-pill)",
      font: mono ? "var(--mono-sm)" : "var(--ui-xs)",
      letterSpacing: mono ? 0 : ".01em",
      whiteSpace: "nowrap",
      ...tones[tone],
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: 13
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const SIZES = {
  sm: {
    h: 32,
    px: 12,
    font: "var(--ui-sm)",
    gap: 6,
    icon: 15
  },
  md: {
    h: "var(--control-h)",
    px: 18,
    font: "var(--ui-button)",
    gap: 8,
    icon: 17
  },
  lg: {
    h: "var(--control-h-lg)",
    px: 26,
    font: "500 15.5px/1 var(--font-ui)",
    gap: 9,
    icon: 18
  }
};
function Button({
  variant = "primary",
  size = "md",
  icon,
  iconRight,
  disabled,
  fullWidth,
  onClick,
  children,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false),
    [p, setP] = React.useState(false);
  const s = SIZES[size] || SIZES.md;
  const skin = {
    primary: {
      background: h ? "var(--brass-300)" : "var(--brass)",
      color: "var(--text-on-accent)",
      border: "1px solid transparent",
      boxShadow: h ? "var(--glow-brass)" : "var(--shadow-2)"
    },
    secondary: {
      background: h ? "var(--surface-3)" : "var(--surface-2)",
      color: "var(--ink-1)",
      border: "1px solid " + (h ? "var(--border-strong)" : "var(--border-field)"),
      boxShadow: "var(--shadow-1)"
    },
    ghost: {
      background: h ? "var(--wash-1)" : "transparent",
      color: h ? "var(--ink-1)" : "var(--ink-2)",
      border: "1px solid transparent",
      boxShadow: "none"
    },
    quiet: {
      background: "transparent",
      color: h ? "var(--brass-100)" : "var(--brass-200)",
      border: "1px solid transparent",
      boxShadow: "none",
      padding: 0,
      height: "auto"
    },
    danger: {
      background: h ? "var(--clay)" : "var(--clay-wash)",
      color: h ? "var(--ink-1)" : "#E5A793",
      border: "1px solid var(--clay)",
      boxShadow: "none"
    }
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => {
      setH(false);
      setP(false);
    },
    onMouseDown: () => setP(true),
    onMouseUp: () => setP(false),
    style: {
      display: fullWidth ? "flex" : "inline-flex",
      width: fullWidth ? "100%" : undefined,
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.h,
      padding: variant === "quiet" ? 0 : `0 ${s.px}px`,
      font: s.font,
      letterSpacing: "var(--tracking-tight)",
      borderRadius: variant === "quiet" ? 0 : "var(--radius-sm)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? .38 : 1,
      transform: p && !disabled ? "var(--press-scale)" : "none",
      transition: "background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out),transform var(--dur-tap) var(--ease-out),box-shadow var(--dur-base) var(--ease-out)",
      ...skin,
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: s.icon
  }), children, iconRight && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: iconRight,
    size: s.icon
  }));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function IconButton({
  icon,
  label,
  size = 40,
  iconSize,
  variant = "ghost",
  active,
  onClick,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const skin = {
    ghost: {
      background: h ? "var(--wash-2)" : "transparent",
      color: h ? "var(--ink-1)" : "var(--ink-2)",
      border: "1px solid transparent"
    },
    surface: {
      background: h ? "var(--surface-3)" : "var(--surface-2)",
      color: "var(--ink-1)",
      border: "1px solid var(--border-field)"
    },
    glass: {
      background: h ? "rgba(245,238,230,.16)" : "rgba(12,11,10,.42)",
      color: "var(--ink-1)",
      border: "1px solid var(--line-2)",
      backdropFilter: "var(--blur-chrome)"
    },
    brass: {
      background: h ? "var(--brass-300)" : "var(--brass)",
      color: "var(--text-on-accent)",
      border: "1px solid transparent",
      boxShadow: "var(--shadow-2)"
    }
  }[variant];
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    onClick: onClick,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: size,
      height: size,
      borderRadius: "var(--radius-pill)",
      cursor: "pointer",
      flex: "0 0 auto",
      transition: "background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)",
      ...skin,
      ...(active ? {
        color: "var(--brass-200)"
      } : null),
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: icon,
    size: iconSize || Math.round(size * .45)
  }));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Panel.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Panel({
  children,
  variant = "matte",
  pad = "var(--gutter-panel)",
  style,
  ...rest
}) {
  const skin = {
    matte: {
      background: "var(--surface-card)",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--shadow-2)"
    },
    inset: {
      background: "var(--surface-inset)",
      border: "1px solid var(--border-hairline)",
      boxShadow: "var(--inset-field)"
    },
    glass: {
      background: "var(--panel-blur-bg)",
      backdropFilter: "var(--panel-blur)",
      border: "1px solid var(--line-1)",
      boxShadow: "var(--shadow-3)"
    },
    solid: {
      background: "var(--panel-solid-bg)",
      border: "1px solid var(--line-2)",
      boxShadow: "var(--shadow-3)"
    },
    quiet: {
      background: "transparent",
      border: "1px solid var(--border-hairline)"
    }
  }[variant];
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      borderRadius: "var(--radius-lg)",
      padding: pad,
      ...skin,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Panel.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Dialog.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Dialog({
  open = true,
  title,
  children,
  footer,
  onClose,
  width = 460,
  style,
  ...rest
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--surface-overlay)",
      backdropFilter: "var(--blur-chrome)",
      zIndex: 60
    }
  }, /*#__PURE__*/React.createElement("div", _extends({
    role: "dialog",
    "aria-modal": "true",
    style: {
      width,
      maxWidth: "calc(100% - 48px)",
      background: "var(--surface-2)",
      border: "1px solid var(--border-field)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-4)",
      padding: "var(--space-7)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: "var(--space-5)"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--display-sm)",
      color: "var(--ink-1)",
      margin: 0,
      flex: 1,
      letterSpacing: "var(--tracking-display)"
    }
  }, title), onClose && /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: "x",
    label: "Close",
    size: 32,
    onClick: onClose
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--ui-md)",
      color: "var(--text-body)",
      marginTop: "var(--space-5)",
      maxWidth: "52ch"
    }
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      gap: "var(--space-4)",
      marginTop: "var(--space-7)"
    }
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/feedback/LintList.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function LintList({
  items = [],
  style,
  ...rest
}) {
  if (!items.length) return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      font: "var(--ui-sm)",
      color: "var(--success)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "check",
    size: 14
  }), " Looks good.");
  return /*#__PURE__*/React.createElement("ul", _extends({
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-3)",
      ...style
    }
  }, rest), items.map((it, i) => {
    const err = it.level === "error";
    return /*#__PURE__*/React.createElement("li", {
      key: i,
      style: {
        display: "flex",
        gap: 8,
        font: "var(--ui-sm)",
        color: err ? "#E0A18B" : "#E6BC76"
      }
    }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: err ? "triangle-alert" : "info",
      size: 14,
      style: {
        marginTop: 2,
        flex: "0 0 auto"
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-body)"
      }
    }, it.message));
  }));
}
Object.assign(__ds_scope, { LintList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/LintList.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Notice.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Notice({
  tone = "info",
  title,
  children,
  action,
  onAction,
  glass,
  style,
  ...rest
}) {
  const map = {
    info: {
      icon: "info",
      c: "var(--brass-200)",
      wash: "var(--brass-wash)",
      line: "var(--brass-line)"
    },
    warn: {
      icon: "triangle-alert",
      c: "#E6BC76",
      wash: "var(--amber-wash)",
      line: "rgba(206,155,69,.38)"
    },
    error: {
      icon: "triangle-alert",
      c: "#E0A18B",
      wash: "var(--clay-wash)",
      line: "rgba(180,102,76,.4)"
    },
    calm: {
      icon: "clock",
      c: "var(--ink-2)",
      wash: "var(--wash-1)",
      line: "var(--line-1)"
    }
  }[tone];
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      gap: "var(--space-4)",
      padding: "14px 16px",
      borderRadius: "var(--radius-md)",
      background: glass ? "rgba(12,11,10,.55)" : map.wash,
      backdropFilter: glass ? "var(--blur-chrome)" : undefined,
      border: "1px solid " + map.line,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: map.icon,
    size: 17,
    color: map.c,
    style: {
      marginTop: 2
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, title && /*#__PURE__*/React.createElement("div", {
    style: {
      font: "500 14.5px/1.4 var(--font-ui)",
      color: "var(--ink-1)"
    }
  }, title), children && /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-body)",
      marginTop: title ? 4 : 0,
      maxWidth: "56ch"
    }
  }, children), action && /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    style: {
      marginTop: "var(--space-4)",
      background: "none",
      border: "none",
      padding: 0,
      cursor: "pointer",
      font: "var(--ui-button)",
      color: map.c,
      textDecoration: "underline",
      textUnderlineOffset: 3
    }
  }, action)));
}
Object.assign(__ds_scope, { Notice });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Notice.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function ProgressBar({
  value,
  label,
  detail,
  indeterminate,
  style,
  ...rest
}) {
  const pct = Math.max(0, Math.min(100, (value || 0) * 100));
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      ...style
    }
  }, rest), (label || detail) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline",
      gap: 12,
      marginBottom: "var(--space-3)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-body)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--text-quiet)"
    }
  }, detail)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 3,
      borderRadius: 2,
      background: "var(--wash-2)",
      overflow: "hidden"
    }
  }, indeterminate ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      width: "38%",
      borderRadius: 2,
      background: "linear-gradient(90deg,transparent,var(--brass-300),transparent)",
      animation: "ss-drift 2.4s var(--ease-in-out) infinite"
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: 0,
      width: pct + "%",
      borderRadius: 2,
      background: "var(--brass)",
      transition: "width var(--dur-slow) var(--ease-out)"
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/StageList.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/* The seven creation stages in warm plain language. Never show engine phases. */
const CREATION_STAGES = [{
  id: "import",
  label: "Getting your photo ready…"
}, {
  id: "look",
  label: "Looking at your photo…"
}, {
  id: "write",
  label: "Writing your song…"
}, {
  id: "studio",
  label: "Setting up the studio…"
}, {
  id: "melody",
  label: "Composing the melody…"
}, {
  id: "life",
  label: "Bringing it to life…"
}, {
  id: "finish",
  label: "Finishing touches…"
}];
function StageList({
  stages = CREATION_STAGES,
  activeIndex = 0,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("ol", _extends({
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-4)",
      ...style
    }
  }, rest), stages.map((s, i) => {
    const done = i < activeIndex,
      now = i === activeIndex;
    return /*#__PURE__*/React.createElement("li", {
      key: s.id || i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: "var(--space-4)",
        font: now ? "500 16px/1.4 var(--font-ui)" : "var(--ui-md)",
        color: now ? "var(--ink-1)" : done ? "var(--text-quiet)" : "var(--text-faint)",
        transition: "color var(--dur-slow) var(--ease-out)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 18,
        height: 18,
        flex: "0 0 auto"
      }
    }, done ? /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: "check",
      size: 14,
      color: "var(--brass-600)"
    }) : now ? /*#__PURE__*/React.createElement("span", {
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--brass-200)",
        boxShadow: "0 0 0 6px var(--brass-wash)",
        animation: "ss-breathe var(--dur-breath) var(--ease-in-out) infinite"
      }
    }) : /*#__PURE__*/React.createElement("span", {
      style: {
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: "var(--line-3)"
      }
    })), s.label);
  }));
}
Object.assign(__ds_scope, { CREATION_STAGES, StageList });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/StageList.jsx", error: String((e && e.message) || e) }); }

// components/forms/Disclosure.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Disclosure({
  summary,
  open,
  onToggle,
  defaultOpen = false,
  children,
  style,
  ...rest
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const isOpen = open !== undefined ? open : inner;
  const toggle = () => {
    onToggle ? onToggle(!isOpen) : setInner(!isOpen);
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      borderTop: "1px solid var(--border-hairline)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: toggle,
    "aria-expanded": isOpen,
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-3)",
      width: "100%",
      padding: "14px 0",
      background: "none",
      border: "none",
      cursor: "pointer",
      font: "var(--ui-md)",
      color: isOpen ? "var(--ink-1)" : "var(--text-quiet)",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 15,
    style: {
      color: "var(--brass-300)",
      transform: isOpen ? "none" : "rotate(-90deg)",
      transition: "transform var(--dur-base) var(--ease-out)"
    }
  }), summary), isOpen && /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 0 var(--space-6) 26px",
      animation: "none"
    }
  }, children));
}
Object.assign(__ds_scope, { Disclosure });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Disclosure.jsx", error: String((e && e.message) || e) }); }

// components/forms/SegmentedChoice.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SegmentedChoice({
  label,
  value,
  onChange,
  options = [],
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: style
  }, rest), label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-label)",
      color: "var(--text-quiet)",
      marginBottom: "var(--space-4)"
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    role: "radiogroup",
    style: {
      display: "grid",
      gridTemplateColumns: `repeat(${options.length},1fr)`,
      gap: "var(--space-3)"
    }
  }, options.map(o => {
    const v = typeof o === "string" ? o : o.value,
      l = typeof o === "string" ? o : o.label,
      sel = v === value;
    return /*#__PURE__*/React.createElement("button", {
      key: v,
      type: "button",
      role: "radio",
      "aria-checked": sel,
      onClick: () => onChange && onChange(v),
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: "var(--control-h-lg)",
        padding: "12px 10px",
        cursor: "pointer",
        font: sel ? "500 14.5px/1.2 var(--font-ui)" : "var(--ui-md)",
        color: sel ? "var(--brass-100)" : "var(--ink-2)",
        background: sel ? "var(--brass-wash)" : "var(--wash-1)",
        border: "1px solid " + (sel ? "var(--border-selected)" : "var(--border-hairline)"),
        borderRadius: "var(--radius-sm)",
        boxShadow: sel ? "var(--glow-brass)" : "none",
        transition: "all var(--dur-fast) var(--ease-out)"
      }
    }, typeof o === "object" && o.icon && /*#__PURE__*/React.createElement(__ds_scope.Icon, {
      name: o.icon,
      size: 18
    }), l);
  })));
}
Object.assign(__ds_scope, { SegmentedChoice });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SegmentedChoice.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  label,
  value,
  onChange,
  options = [],
  id,
  style,
  ...rest
}) {
  const [foc, setFoc] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      display: "block",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-label)",
      color: "var(--text-quiet)",
      marginBottom: "var(--space-3)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      display: "block"
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    id: id,
    value: value,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFoc(true),
    onBlur: () => setFoc(false),
    style: {
      width: "100%",
      height: "var(--control-h)",
      padding: "0 38px 0 14px",
      font: "var(--ui-md)",
      color: "var(--ink-1)",
      background: "var(--surface-field)",
      appearance: "none",
      border: "1px solid " + (foc ? "var(--brass-line)" : "var(--border-field)"),
      borderRadius: "var(--radius-sm)",
      boxShadow: foc ? "var(--glow-brass)" : "var(--inset-field)",
      outline: "none",
      cursor: "pointer"
    }
  }, rest), options.map(o => {
    const v = typeof o === "string" ? o : o.value,
      l = typeof o === "string" ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v,
      style: {
        background: "var(--surface-2)"
      }
    }, l);
  })), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "chevron-down",
    size: 16,
    style: {
      position: "absolute",
      right: 13,
      top: "50%",
      transform: "translateY(-50%)",
      color: "var(--ink-3)",
      pointerEvents: "none"
    }
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Switch({
  checked,
  onChange,
  label,
  hint,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", _extends({
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: "var(--space-4)",
      cursor: "pointer",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "switch",
    "aria-checked": !!checked,
    onClick: () => onChange && onChange(!checked),
    style: {
      position: "relative",
      flex: "0 0 auto",
      width: 40,
      height: 24,
      marginTop: 1,
      borderRadius: "var(--radius-pill)",
      background: checked ? "var(--brass)" : "var(--surface-3)",
      border: "1px solid " + (checked ? "var(--brass-600)" : "var(--border-field)"),
      cursor: "pointer",
      transition: "background var(--dur-base) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: checked ? 18 : 2,
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: checked ? "var(--ink-inverse)" : "var(--ink-2)",
      boxShadow: "var(--shadow-1)",
      transition: "left var(--dur-base) var(--ease-out)"
    }
  })), (label || hint) && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block"
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-md)",
      color: "var(--ink-1)"
    }
  }, label), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-sm)",
      color: "var(--text-quiet)",
      marginTop: 2,
      maxWidth: "48ch"
    }
  }, hint)));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function TextField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  multiline,
  rows = 4,
  mono,
  invalid,
  id,
  style,
  ...rest
}) {
  const [foc, setFoc] = React.useState(false);
  const El = multiline ? "textarea" : "input";
  return /*#__PURE__*/React.createElement("label", {
    htmlFor: id,
    style: {
      display: "block",
      ...style
    }
  }, label && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-label)",
      color: "var(--text-quiet)",
      marginBottom: "var(--space-3)"
    }
  }, label), /*#__PURE__*/React.createElement(El, _extends({
    id: id,
    rows: multiline ? rows : undefined,
    value: value,
    placeholder: placeholder,
    onChange: e => onChange && onChange(e.target.value),
    onFocus: () => setFoc(true),
    onBlur: () => setFoc(false),
    style: {
      width: "100%",
      display: "block",
      resize: multiline ? "vertical" : undefined,
      minHeight: multiline ? undefined : "var(--control-h)",
      padding: multiline ? "12px 14px" : "0 14px",
      font: mono ? "var(--mono-md)" : "var(--ui-md)",
      color: "var(--ink-1)",
      background: "var(--surface-field)",
      border: "1px solid " + (invalid ? "var(--clay)" : foc ? "var(--brass-line)" : "var(--border-field)"),
      borderRadius: "var(--radius-sm)",
      boxShadow: foc ? "var(--glow-brass)" : "var(--inset-field)",
      outline: "none",
      transition: "border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-base) var(--ease-out)"
    }
  }, rest)), hint && /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-xs)",
      color: "var(--text-faint)",
      marginTop: "var(--space-2)"
    }
  }, hint));
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// components/media/LyricSheet.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function LyricSheet({
  title,
  stanzas = [],
  epigraph,
  instrumental,
  mode = "blur",
  style,
  ...rest
}) {
  const backing = mode === "solid" ? {
    background: "var(--panel-solid-bg)",
    border: "1px solid var(--line-2)"
  } : {
    background: "var(--panel-blur-bg)",
    backdropFilter: "var(--panel-blur)",
    border: "1px solid var(--line-1)"
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      maxWidth: "calc(var(--measure-lyric) + 96px)",
      borderRadius: "var(--radius-lg)",
      padding: "var(--space-8) var(--space-7)",
      boxShadow: "var(--shadow-3)",
      color: "var(--lyric-text)",
      ...backing,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--display-lg)",
      letterSpacing: "var(--tracking-display)",
      margin: 0,
      color: "var(--lyric-text)",
      textWrap: "pretty"
    }
  }, title), epigraph && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--epigraph)",
      color: "var(--lyric-text-quiet)",
      margin: "var(--space-5) 0 0",
      maxWidth: "30ch",
      textWrap: "pretty"
    }
  }, epigraph), instrumental ? /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--lyric-text-quiet)",
      margin: "var(--space-7) 0 0",
      letterSpacing: ".06em"
    }
  }, "Instrumental") : /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-8)",
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-7)"
    }
  }, stanzas.map((st, i) => /*#__PURE__*/React.createElement("p", {
    key: i,
    style: {
      font: "var(--lyric)",
      color: "var(--lyric-text)",
      margin: 0,
      whiteSpace: "pre-line",
      textWrap: "pretty"
    }
  }, st))));
}
Object.assign(__ds_scope, { LyricSheet });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/LyricSheet.jsx", error: String((e && e.message) || e) }); }

// components/media/PhotoRoom.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function PhotoRoom({
  photo,
  luminance = .5,
  scrim = "radial",
  kenBurns = true,
  children,
  style,
  ...rest
}) {
  const bg = scrim === "vertical" ? "var(--scrim-vertical)" : scrim === "none" ? "none" : "var(--scrim-radial)";
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: "relative",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      background: "var(--ground-deep)",
      ["--photo-lum"]: String(luminance),
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("img", {
    src: photo,
    alt: "",
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      objectFit: "cover",
      animation: kenBurns ? "ss-kenburns var(--dur-kenburns) var(--ease-in-out) infinite alternate" : "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: bg,
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: "100%",
      height: "100%"
    }
  }, children));
}
Object.assign(__ds_scope, { PhotoRoom });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/PhotoRoom.jsx", error: String((e && e.message) || e) }); }

// components/media/PhotoWell.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function PhotoWell({
  src,
  dragging,
  onChoose,
  onClear,
  height = 380,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  const active = dragging || h;
  if (src) return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: "relative",
      height,
      borderRadius: "var(--radius-photo)",
      overflow: "hidden",
      boxShadow: "var(--shadow-photo)",
      border: "1px solid var(--border-hairline)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: "",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--scrim-chrome-bottom)",
      opacity: .7,
      pointerEvents: "none"
    }
  }), onClear && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: 14,
      right: 14
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Button, {
    variant: "secondary",
    size: "sm",
    icon: "image-plus",
    onClick: onClear
  }, "Choose another")));
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onChoose,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "var(--space-4)",
      width: "100%",
      height,
      cursor: "pointer",
      textAlign: "center",
      background: active ? "var(--brass-wash)" : "var(--wash-1)",
      border: "1px dashed " + (active ? "var(--brass-line)" : "var(--border-field)"),
      borderRadius: "var(--radius-photo)",
      boxShadow: active ? "var(--glow-brass)" : "none",
      transition: "background var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: "image-plus",
    size: 30,
    color: active ? "var(--brass-200)" : "var(--ink-3)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--display-sm)",
      color: "var(--ink-1)",
      letterSpacing: "var(--tracking-display)"
    }
  }, dragging ? "Let it go" : "Choose a photo"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-quiet)"
    }
  }, "or drag one here \u2014 png, jpg, webp, bmp, gif"));
}
Object.assign(__ds_scope, { PhotoWell });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/PhotoWell.jsx", error: String((e && e.message) || e) }); }

// components/media/Player.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const fmt = s => {
  s = Math.max(0, Math.round(s || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};
function Player({
  playing,
  position = 0,
  duration = 1,
  volume = .8,
  onToggle,
  onSeek,
  onVolume,
  variant = "glass",
  style,
  ...rest
}) {
  const pct = Math.min(100, position / (duration || 1) * 100);
  const skin = variant === "glass" ? {
    background: "var(--panel-blur-bg)",
    backdropFilter: "var(--panel-blur)",
    border: "1px solid var(--line-1)"
  } : {
    background: "var(--surface-2)",
    border: "1px solid var(--border-hairline)"
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-5)",
      padding: "12px 18px",
      borderRadius: "var(--radius-pill)",
      boxShadow: "var(--shadow-3)",
      ...skin,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: playing ? "pause" : "play",
    label: playing ? "Pause" : "Play",
    variant: "brass",
    size: 46,
    onClick: onToggle
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--lyric-text-quiet)",
      width: 38,
      textAlign: "right"
    }
  }, fmt(position)), /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      onSeek && onSeek((e.clientX - r.left) / r.width * duration);
    },
    style: {
      position: "relative",
      flex: 1,
      height: 22,
      display: "flex",
      alignItems: "center",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height: 3,
      borderRadius: 2,
      background: "rgba(245,238,230,.2)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      width: pct + "%",
      height: 3,
      borderRadius: 2,
      background: "var(--brass-200)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: `calc(${pct}% - 5px)`,
      width: 10,
      height: 10,
      borderRadius: "50%",
      background: "var(--brass-100)",
      boxShadow: "0 0 0 4px rgba(192,151,95,.18)"
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--lyric-text-quiet)",
      width: 38
    }
  }, fmt(duration)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      minWidth: 96
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Icon, {
    name: volume > 0 ? "volume-2" : "volume-x",
    size: 16,
    color: "var(--lyric-text-quiet)"
  }), /*#__PURE__*/React.createElement("div", {
    onClick: e => {
      const r = e.currentTarget.getBoundingClientRect();
      onVolume && onVolume((e.clientX - r.left) / r.width);
    },
    style: {
      position: "relative",
      width: 64,
      height: 18,
      display: "flex",
      alignItems: "center",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height: 3,
      borderRadius: 2,
      background: "rgba(245,238,230,.2)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      width: volume * 100 + "%",
      height: 3,
      borderRadius: 2,
      background: "var(--lyric-text-quiet)"
    }
  }))));
}
Object.assign(__ds_scope, { Player });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/Player.jsx", error: String((e && e.message) || e) }); }

// components/media/SongCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function SongCard({
  photo,
  title,
  genre,
  length,
  date,
  instrumental,
  versions,
  playing,
  onPlay,
  onOpen,
  style,
  ...rest
}) {
  const [h, setH] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", _extends({
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    onClick: onOpen,
    style: {
      position: "relative",
      borderRadius: "var(--radius-photo)",
      overflow: "hidden",
      cursor: "pointer",
      background: "var(--surface-1)",
      border: "1px solid " + (h ? "var(--line-2)" : "var(--border-hairline)"),
      boxShadow: h ? "var(--shadow-4)" : "var(--shadow-photo)",
      transform: h ? "var(--hover-lift)" : "none",
      transition: "transform var(--dur-base) var(--ease-lift),box-shadow var(--dur-base) var(--ease-out),border-color var(--dur-base) var(--ease-out)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "4/3",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: photo,
    alt: "",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      display: "block",
      transform: h ? "scale(1.03)" : "scale(1)",
      transition: "transform var(--dur-slow) var(--ease-serene)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--scrim-chrome-bottom)",
      opacity: h || playing ? .95 : .55,
      transition: "opacity var(--dur-base) var(--ease-out)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 12,
      right: 12,
      display: "flex",
      gap: 6
    }
  }, instrumental && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "glass",
    icon: "audio-lines"
  }, "Instrumental"), versions > 1 && /*#__PURE__*/React.createElement(__ds_scope.Badge, {
    tone: "glass",
    icon: "layers"
  }, versions, " versions")), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 14,
      bottom: 14,
      right: 14,
      display: "flex",
      alignItems: "flex-end",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--display-sm)",
      color: "var(--ink-1)",
      letterSpacing: "var(--tracking-display)",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      textShadow: "0 1px 12px rgba(0,0,0,.6)"
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 5,
      font: "var(--ui-xs)",
      color: "rgba(245,238,230,.72)"
    }
  }, genre && /*#__PURE__*/React.createElement("span", null, genre), genre && /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .45
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--mono-sm)"
    }
  }, length), /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .45
    }
  }, "\xB7"), /*#__PURE__*/React.createElement("span", null, date))), /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: h || playing ? 1 : 0,
      transform: h || playing ? "none" : "translateY(4px)",
      transition: "opacity var(--dur-base) var(--ease-out),transform var(--dur-base) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    icon: playing ? "pause" : "play",
    label: playing ? "Pause" : "Play",
    variant: "glass",
    size: 44,
    onClick: e => {
      e.stopPropagation();
      onPlay && onPlay();
    }
  }))), playing && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 2,
      background: "var(--brass)",
      width: "38%"
    }
  })));
}
Object.assign(__ds_scope, { SongCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/SongCard.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/AppFrame.jsx
try { (() => {
const {
  Icon,
  IconButton
} = window.StillsongDesignSystem_4faa75;
function TitleBar({
  title
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      height: 38,
      padding: "0 14px",
      flex: "0 0 auto",
      borderBottom: "1px solid var(--border-hairline)",
      background: "var(--ground-deep)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "300 15px/1 var(--font-display)",
      letterSpacing: ".01em",
      color: "var(--ink-2)"
    }
  }, "Stillsong"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      textAlign: "center",
      font: "var(--ui-xs)",
      color: "var(--text-faint)"
    }
  }, title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 2
    }
  }, ["minus", "square", "x"].map(n => /*#__PURE__*/React.createElement("span", {
    key: n,
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 30,
      height: 24
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: n,
    size: 11,
    color: "var(--ink-4)"
  })))));
}
function NavRail({
  view,
  onNav
}) {
  const items = [{
    id: "create",
    icon: "image-plus",
    label: "Create"
  }, {
    id: "sanctuary",
    icon: "layout-grid",
    label: "Sanctuary"
  }, {
    id: "settings",
    icon: "settings",
    label: "About"
  }];
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 6,
      width: 72,
      padding: "18px 0",
      flex: "0 0 auto",
      borderRight: "1px solid var(--border-hairline)",
      background: "var(--ground-deep)"
    }
  }, items.map(it => {
    const on = view === it.id;
    return /*#__PURE__*/React.createElement("button", {
      key: it.id,
      onClick: () => onNav(it.id),
      title: it.label,
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 5,
        width: 56,
        padding: "10px 0",
        cursor: "pointer",
        background: on ? "var(--brass-wash)" : "transparent",
        border: "1px solid " + (on ? "var(--brass-line)" : "transparent"),
        borderRadius: "var(--radius-md)",
        color: on ? "var(--brass-200)" : "var(--ink-3)",
        transition: "all var(--dur-fast) var(--ease-out)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: it.icon,
      size: 19
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--ui-xs)",
        letterSpacing: ".01em"
      }
    }, it.label));
  }));
}
function AppFrame({
  view,
  onNav,
  title,
  chrome = true,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      overflow: "hidden",
      background: "var(--ground)"
    }
  }, /*#__PURE__*/React.createElement(TitleBar, {
    title: title
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flex: 1,
      minHeight: 0
    }
  }, chrome && /*#__PURE__*/React.createElement(NavRail, {
    view: view,
    onNav: onNav
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      position: "relative",
      flex: 1,
      minWidth: 0,
      overflow: "hidden"
    }
  }, children)));
}
Object.assign(window, {
  AppFrame,
  NavRail,
  TitleBar
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/AppFrame.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/CreateScreen.jsx
try { (() => {
const {
  Button,
  PhotoWell,
  SegmentedChoice,
  TextField,
  Select,
  Disclosure,
  StageList,
  CREATION_STAGES,
  ProgressBar,
  Notice,
  Panel,
  Badge
} = window.StillsongDesignSystem_4faa75;
function CreateScreen({
  onDone
}) {
  const [photo, setPhoto] = React.useState(null);
  const [voice, setVoice] = React.useState("female");
  const [hint, setHint] = React.useState("");
  const [lang, setLang] = React.useState("English");
  const [open, setOpen] = React.useState(false);
  const [stage, setStage] = React.useState(-1);
  const [failed, setFailed] = React.useState(false);
  const [showDetail, setShowDetail] = React.useState(false);
  const song = window.SS_DATA.SONGS[0];
  React.useEffect(() => {
    if (stage < 0 || failed) return;
    if (stage >= CREATION_STAGES.length) {
      const t = setTimeout(() => onDone && onDone(), 700);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStage(s => s + 1), stage === 2 ? 2600 : 1700);
    return () => clearTimeout(t);
  }, [stage, failed]);
  const running = stage >= 0 && !failed;
  if (failed) return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      placeItems: "center",
      height: "100%",
      padding: "var(--gutter-screen)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 520,
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: photo,
    alt: "",
    style: {
      width: "100%",
      height: 200,
      objectFit: "cover",
      borderRadius: "var(--radius-photo)",
      opacity: .45,
      marginBottom: "var(--space-7)"
    }
  }), /*#__PURE__*/React.createElement(Notice, {
    tone: "error",
    title: "Something went wrong while writing your song",
    action: "Try again",
    onAction: () => {
      setFailed(false);
      setStage(0);
    }
  }, "Nothing was lost \u2014 your photo and your choices are still here."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-5)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: () => setShowDetail(!showDetail)
  }, showDetail ? "hide details" : "details"), showDetail && /*#__PURE__*/React.createElement(Panel, {
    variant: "inset",
    pad: 14,
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("code", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--text-quiet)",
      whiteSpace: "pre-wrap"
    }
  }, "ComposeError: repair round failed after 2 attempts (llama-server 127.0.0.1:8081, /health ok, ctx 4096)")))));
  if (running) return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1.1fr 1fr",
      height: "100%",
      alignItems: "center",
      gap: "var(--space-9)",
      padding: "var(--gutter-screen)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      borderRadius: "var(--radius-photo)",
      overflow: "hidden",
      boxShadow: "var(--shadow-photo)",
      aspectRatio: "4/3"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: photo,
    alt: "",
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover",
      animation: "ss-kenburns 90s var(--ease-in-out) infinite alternate"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "radial-gradient(120% 100% at 50% 120%,var(--ambient-soft),transparent 70%)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 400
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-eyebrow)",
      letterSpacing: "var(--tracking-eyebrow)",
      textTransform: "uppercase",
      color: "var(--brass-300)"
    }
  }, "Your song is being made"), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--space-6)"
    }
  }), /*#__PURE__*/React.createElement(StageList, {
    activeIndex: Math.min(stage, CREATION_STAGES.length - 1)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--space-7)"
    }
  }), stage >= 3 && /*#__PURE__*/React.createElement("div", {
    style: {
      opacity: 0,
      animation: "ss-rise var(--dur-reveal) var(--ease-serene) forwards"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-quiet)"
    }
  }, "It will be called"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--display-md)",
      color: "var(--ink-1)",
      letterSpacing: "var(--tracking-display)",
      marginTop: 6
    }
  }, song.title)), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--space-7)"
    }
  }), stage === 4 && /*#__PURE__*/React.createElement(ProgressBar, {
    indeterminate: true,
    label: "Composing the melody\u2026",
    detail: "0:42 written"
  }), stage === 5 && /*#__PURE__*/React.createElement(ProgressBar, {
    value: .62,
    label: "Bringing it to life\u2026",
    detail: "about 40 seconds left"
  }), stage !== 4 && stage !== 5 && /*#__PURE__*/React.createElement(ProgressBar, {
    indeterminate: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-7)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: () => setFailed(true)
  }, "(demo: show the failure state)"))));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      overflowY: "auto",
      padding: "var(--space-9) var(--gutter-screen)",
      background: photo ? "radial-gradient(90% 70% at 50% 0%,var(--ambient-soft),transparent 70%)" : "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 680,
      margin: "0 auto"
    }
  }, /*#__PURE__*/React.createElement(PhotoWell, {
    src: photo,
    height: photo ? 360 : 330,
    onChoose: () => setPhoto(window.SS_DATA.SONGS[0].photo),
    onClear: () => setPhoto(null)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--space-8)"
    }
  }), /*#__PURE__*/React.createElement(SegmentedChoice, {
    label: "Voice",
    value: voice,
    onChange: setVoice,
    options: [{
      value: "instrumental",
      label: "Instrumental",
      icon: "audio-lines"
    }, {
      value: "female",
      label: "Female vocals",
      icon: "mic"
    }, {
      value: "male",
      label: "Male vocals",
      icon: "mic"
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--space-7)"
    }
  }), /*#__PURE__*/React.createElement(Disclosure, {
    summary: "Add a touch of direction (optional)",
    open: open,
    onToggle: setOpen
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-5)",
      maxWidth: 400
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Genre or mood",
    placeholder: "slow folk ballad",
    value: hint,
    onChange: setHint
  }), voice !== "instrumental" && /*#__PURE__*/React.createElement(Select, {
    label: "Lyrics language",
    value: lang,
    onChange: setLang,
    options: ["English", "Spanish", "French", "German", "Italian", "Portuguese", "Japanese", "Korean", "Chinese"]
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: "var(--space-8)",
      borderTop: "1px solid var(--border-hairline)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-5)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    icon: "wand-sparkles",
    disabled: !photo,
    onClick: () => setStage(0)
  }, "Create My Song"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-faint)"
    }
  }, photo ? "About two minutes. Everything happens on your computer." : "Choose a photo to begin."))));
}
window.CreateScreen = CreateScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/CreateScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/FirstRunScreen.jsx
try { (() => {
const {
  Button,
  Panel,
  Notice,
  ProgressBar,
  Icon,
  Badge,
  TextField,
  Switch
} = window.StillsongDesignSystem_4faa75;
const STEPS = ["Welcome", "Your computer", "What Stillsong needs", "Where to keep them", "Setting up", "Almost ready"];
function Shell({
  step,
  title,
  lede,
  children,
  footer
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      placeItems: "center",
      height: "100%",
      padding: "var(--gutter-screen)",
      background: "radial-gradient(80% 60% at 50% 0%,rgba(58,47,40,.5),transparent 70%)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 600
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 6,
      marginBottom: "var(--space-8)"
    }
  }, STEPS.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: s,
    style: {
      flex: 1,
      height: 2,
      borderRadius: 2,
      background: i <= step ? "var(--brass)" : "var(--wash-2)"
    }
  }))), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--display-lg)",
      color: "var(--ink-1)",
      margin: 0,
      letterSpacing: "var(--tracking-display)",
      textWrap: "pretty"
    }
  }, title), lede && /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--ui-lg)",
      color: "var(--text-body)",
      margin: "var(--space-5) 0 0",
      maxWidth: "52ch",
      textWrap: "pretty"
    }
  }, lede), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-8)"
    }
  }, children), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-5)",
      marginTop: "var(--space-8)"
    }
  }, footer)));
}
function Line({
  icon,
  label,
  value,
  tone
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 0",
      borderTop: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: icon,
    size: 16,
    color: tone === "bad" ? "#E0A18B" : tone === "warn" ? "#E6BC76" : "var(--sage)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: "var(--ui-md)",
      color: "var(--ink-1)"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--text-quiet)"
    }
  }, value));
}
function FirstRunScreen({
  onFinish
}) {
  const [step, setStep] = React.useState(0);
  const [hw, setHw] = React.useState("ok");
  const [paused, setPaused] = React.useState(false);
  const next = () => step < 5 ? setStep(step + 1) : onFinish();
  if (step === 0) return /*#__PURE__*/React.createElement(Shell, {
    step: 0,
    title: "Turn your photos into songs.",
    lede: "Choose a photo and Stillsong writes and performs a song about it. Everything happens on your computer \u2014 nothing you make ever leaves it.",
    footer: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "lg",
      onClick: next
    }, "Begin")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12
    }
  }, ["stillsong-harbour", "stillsong-field", "stillsong-window"].map(s => /*#__PURE__*/React.createElement("img", {
    key: s,
    src: `https://picsum.photos/seed/${s}/500/400`,
    alt: "",
    style: {
      flex: 1,
      height: 150,
      objectFit: "cover",
      borderRadius: "var(--radius-photo)",
      boxShadow: "var(--shadow-photo)",
      opacity: .8
    }
  }))));
  if (step === 1) return /*#__PURE__*/React.createElement(Shell, {
    step: 1,
    title: "Let's check this computer.",
    lede: "Stillsong does all its work here, so it needs a little room to work in.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, hw !== "bad" && /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "lg",
      onClick: next
    }, "Continue"), /*#__PURE__*/React.createElement(Button, {
      variant: "quiet",
      onClick: () => setHw(hw === "ok" ? "warn" : hw === "warn" ? "bad" : "ok")
    }, "(demo: next hardware case)"))
  }, /*#__PURE__*/React.createElement(Panel, {
    pad: 18
  }, /*#__PURE__*/React.createElement(Line, {
    icon: "check",
    label: "Windows 11, 64-bit",
    value: "ok"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: hw === "bad" ? "x" : "check",
    label: "Graphics card",
    value: hw === "ok" ? "NVIDIA · 24 GB" : hw === "warn" ? "NVIDIA · 8 GB" : "NVIDIA · 6 GB",
    tone: hw === "bad" ? "bad" : hw === "warn" ? "warn" : "good"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: "check",
    label: "Memory",
    value: "64 GB"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: "check",
    label: "Free space on C:",
    value: "412 GB"
  })), hw === "warn" && /*#__PURE__*/React.createElement(Notice, {
    tone: "warn",
    style: {
      marginTop: "var(--space-6)"
    },
    title: "This will take a little longer"
  }, "Your graphics card has 8 GB of memory \u2014 songs will sound exactly as good, but they'll take several times longer to create, and will run up to about two minutes."), hw === "bad" && /*#__PURE__*/React.createElement(Notice, {
    tone: "error",
    style: {
      marginTop: "var(--space-6)"
    },
    title: "This computer can't run Stillsong"
  }, "Stillsong needs an NVIDIA graphics card with at least 8 GB of memory. This one has 6 GB."));
  if (step === 2) return /*#__PURE__*/React.createElement(Shell, {
    step: 2,
    title: "What Stillsong needs.",
    lede: "Three pieces, downloaded once. After this, Stillsong works completely offline.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "lg",
      onClick: next
    }, "Choose where they go"), /*#__PURE__*/React.createElement("span", {
      style: {
        font: "var(--ui-sm)",
        color: "var(--text-faint)"
      }
    }, "Nothing is downloaded yet."))
  }, /*#__PURE__*/React.createElement(Panel, {
    pad: 18
  }, /*#__PURE__*/React.createElement(Line, {
    icon: "pen-line",
    label: "A songwriter",
    value: "7.4 GB"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: "music",
    label: "A composer and its instruments",
    value: "14\u201315 GB"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: "audio-lines",
    label: "A sound engine",
    value: "3\u20134 GB"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      paddingTop: 14,
      marginTop: 2,
      borderTop: "1px solid var(--border-field)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-md)",
      color: "var(--ink-1)"
    }
  }, "About 25 GB in total"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--text-quiet)"
    }
  }, "from Hugging Face and GitHub"))));
  if (step === 3) return /*#__PURE__*/React.createElement(Shell, {
    step: 3,
    title: "Where should they live?",
    lede: "They're large, so you can keep them on another drive if you'd rather.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "lg",
      onClick: next
    }, "Download"), /*#__PURE__*/React.createElement(Button, {
      variant: "secondary"
    }, "Change\u2026"))
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Folder",
    mono: true,
    value: "%LOCALAPPDATA%\\\\com.example.stillsong\\\\components\\\\",
    hint: "412 GB free on this drive \u2014 40 GB is needed."
  }));
  if (step === 4) return /*#__PURE__*/React.createElement(Shell, {
    step: 4,
    title: paused ? "Paused." : "Setting things up.",
    lede: paused ? "Pick it up whenever you like — Stillsong remembers where it got to, even if you close it." : "You can leave this running. It picks up where it left off if the connection drops.",
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: paused ? "primary" : "secondary",
      size: "lg",
      onClick: () => setPaused(!paused)
    }, paused ? "Resume" : "Pause"), /*#__PURE__*/React.createElement(Button, {
      variant: "quiet",
      onClick: next
    }, "(demo: finish)"))
  }, /*#__PURE__*/React.createElement(Panel, {
    pad: 20,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    value: 1,
    label: "The songwriter",
    detail: "7.4 / 7.4 GB"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    value: paused ? .42 : .58,
    indeterminate: !paused,
    label: "The composer",
    detail: paused ? "paused · 6.2 / 14.8 GB" : "8.6 / 14.8 GB · 24 MB/s"
  }), /*#__PURE__*/React.createElement(ProgressBar, {
    value: 0,
    label: "The sound engine",
    detail: "waiting"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      font: "var(--ui-sm)",
      color: "var(--text-quiet)",
      paddingTop: 14,
      borderTop: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "16.0 of 25.2 GB"), /*#__PURE__*/React.createElement("span", null, paused ? "—" : "about 6 minutes left"))));
  return /*#__PURE__*/React.createElement(Shell, {
    step: 5,
    title: "Almost ready.",
    lede: "Warming up the studio and checking everything answers.",
    footer: /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "lg",
      onClick: onFinish
    }, "Start with a photo")
  }, /*#__PURE__*/React.createElement(Panel, {
    pad: 18
  }, /*#__PURE__*/React.createElement(Line, {
    icon: "check",
    label: "The songwriter answers",
    value: "ok"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: "check",
    label: "The studio answers",
    value: "ok"
  }), /*#__PURE__*/React.createElement(Line, {
    icon: "check",
    label: "Instruments found",
    value: "ok"
  })));
}
window.FirstRunScreen = FirstRunScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/FirstRunScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/RemixScreen.jsx
try { (() => {
const {
  TextField,
  Panel,
  Button,
  SegmentedChoice,
  Disclosure,
  LintList,
  Badge,
  Icon,
  IconButton
} = window.StillsongDesignSystem_4faa75;
function TagLyrics({
  value,
  onChange
}) {
  const [foc, setFoc] = React.useState(false);
  const html = value.replace(/\[([a-z ]+)\]/g, '<span style="color:var(--brass-200)">[$1]</span>');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      font: "var(--ui-label)",
      color: "var(--text-quiet)",
      marginBottom: "var(--space-3)"
    }
  }, "Lyrics"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      border: "1px solid " + (foc ? "var(--brass-line)" : "var(--border-field)"),
      borderRadius: "var(--radius-sm)",
      background: "var(--surface-field)",
      boxShadow: "var(--inset-field)"
    }
  }, /*#__PURE__*/React.createElement("pre", {
    "aria-hidden": "true",
    style: {
      margin: 0,
      padding: "12px 14px",
      font: "var(--mono-md)",
      color: "var(--ink-1)",
      whiteSpace: "pre-wrap",
      minHeight: 200
    },
    dangerouslySetInnerHTML: {
      __html: html
    }
  }), /*#__PURE__*/React.createElement("textarea", {
    value: value,
    onChange: e => onChange(e.target.value),
    onFocus: () => setFoc(true),
    onBlur: () => setFoc(false),
    spellCheck: false,
    style: {
      position: "absolute",
      inset: 0,
      width: "100%",
      height: "100%",
      padding: "12px 14px",
      font: "var(--mono-md)",
      color: "transparent",
      caretColor: "var(--brass-100)",
      background: "transparent",
      border: "none",
      outline: "none",
      resize: "none",
      whiteSpace: "pre-wrap"
    }
  })));
}
function RemixScreen({
  song,
  onBack,
  onSubmit
}) {
  const [title, setTitle] = React.useState(song.title);
  const [caption, setCaption] = React.useState(song.caption);
  const [seed, setSeed] = React.useState("keep");
  const [lyrics, setLyrics] = React.useState("[verse]\n" + (song.stanzas ? song.stanzas.join("\n\n[chorus]\n") : "") + "\n\n[outro]\nnearly dark, nearly home");
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      overflowY: "auto",
      padding: "var(--space-8) var(--gutter-screen) var(--space-9)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      marginBottom: "var(--space-7)"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "chevron-left",
    label: "Back",
    onClick: onBack
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-eyebrow)",
      letterSpacing: "var(--tracking-eyebrow)",
      textTransform: "uppercase",
      color: "var(--brass-300)"
    }
  }, "Remix"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--display-md)",
      color: "var(--ink-1)",
      margin: "6px 0 0",
      letterSpacing: "var(--tracking-display)"
    }
  }, song.title)), /*#__PURE__*/React.createElement(Badge, {
    mono: true
  }, "renders up to 2:40")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1.5fr) 320px",
      gap: "var(--space-8)",
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Title",
    value: title,
    onChange: setTitle
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(TextField, {
    label: "What's in the photo",
    multiline: true,
    rows: 3,
    value: caption,
    onChange: setCaption
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement(LintList, {
    items: caption.length > 90 ? [{
      level: "warn",
      message: "This is getting long — the songwriter may skip the end."
    }] : []
  }))), /*#__PURE__*/React.createElement(TagLyrics, {
    value: lyrics,
    onChange: setLyrics
  }), /*#__PURE__*/React.createElement(SegmentedChoice, {
    label: "Feel",
    value: seed,
    onChange: setSeed,
    options: [{
      value: "keep",
      label: "Keep original",
      icon: "lock"
    }, {
      value: "new",
      label: "New seed",
      icon: "dices"
    }],
    style: {
      maxWidth: 320
    }
  }), /*#__PURE__*/React.createElement(Disclosure, {
    summary: "Advanced"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "var(--space-5)",
      maxWidth: 460
    }
  }, /*#__PURE__*/React.createElement(TextField, {
    label: "Steps",
    mono: true,
    value: "30"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Guidance",
    mono: true,
    value: "4.5"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Encode guidance",
    mono: true,
    value: "2.0"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Top K",
    mono: true,
    value: "50"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "MP3 quality",
    mono: true,
    value: "V0"
  }), /*#__PURE__*/React.createElement(TextField, {
    label: "Tiled decode",
    mono: true,
    value: "off"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-5)",
      position: "sticky",
      top: 0
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: song.photo,
    alt: "",
    style: {
      width: "100%",
      aspectRatio: "4/3",
      objectFit: "cover",
      borderRadius: "var(--radius-photo)",
      boxShadow: "var(--shadow-photo)"
    }
  }), /*#__PURE__*/React.createElement(Panel, {
    variant: "quiet",
    pad: 16,
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-quiet)"
    }
  }, "A remix keeps the same photo. It becomes a new version alongside this one."), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    fullWidth: true,
    icon: "shuffle",
    onClick: onSubmit
  }, "Create Remix"))));
}
window.RemixScreen = RemixScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/RemixScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/SanctuaryScreen.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const {
  SongCard,
  Badge,
  Icon,
  IconButton,
  Panel,
  Button
} = window.StillsongDesignSystem_4faa75;
function SearchField({
  value,
  onChange
}) {
  const [foc, setFoc] = React.useState(false);
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 9,
      width: foc || value ? 260 : 210,
      height: 34,
      padding: "0 12px",
      background: "var(--wash-1)",
      border: "1px solid " + (foc ? "var(--brass-line)" : "var(--border-hairline)"),
      borderRadius: "var(--radius-pill)",
      transition: "width var(--dur-base) var(--ease-out)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 15,
    color: "var(--ink-4)"
  }), /*#__PURE__*/React.createElement("input", {
    value: value,
    onChange: e => onChange(e.target.value),
    onFocus: () => setFoc(true),
    onBlur: () => setFoc(false),
    placeholder: "Search your songs",
    style: {
      flex: 1,
      minWidth: 0,
      background: "none",
      border: "none",
      outline: "none",
      font: "var(--ui-sm)",
      color: "var(--ink-1)"
    }
  }));
}
function SanctuaryScreen({
  onOpen,
  onCreate
}) {
  const [q, setQ] = React.useState("");
  const [playing, setPlaying] = React.useState(null);
  const [expanded, setExpanded] = React.useState(null);
  const [empty, setEmpty] = React.useState(false);
  const songs = window.SS_DATA.SONGS.filter(s => (s.title + s.caption).toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      overflowY: "auto",
      padding: "var(--space-8) var(--gutter-screen) var(--space-9)"
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: "var(--space-6)",
      marginBottom: "var(--space-8)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-eyebrow)",
      letterSpacing: "var(--tracking-eyebrow)",
      textTransform: "uppercase",
      color: "var(--brass-300)"
    }
  }, "The Sanctuary"), /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--display-md)",
      color: "var(--ink-1)",
      margin: "8px 0 0",
      letterSpacing: "var(--tracking-display)"
    }
  }, empty ? "Nothing here yet" : `${songs.length} songs`)), /*#__PURE__*/React.createElement(SearchField, {
    value: q,
    onChange: setQ
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "quiet",
    onClick: () => setEmpty(!empty)
  }, empty ? "(demo: show songs)" : "(demo: empty state)")), empty ? /*#__PURE__*/React.createElement("button", {
    onClick: onCreate,
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      width: 340,
      aspectRatio: "4/3",
      cursor: "pointer",
      background: "var(--wash-1)",
      border: "1px dashed var(--border-field)",
      borderRadius: "var(--radius-photo)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "image-plus",
    size: 26,
    color: "var(--brass-300)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--display-sm)",
      color: "var(--ink-1)"
    }
  }, "Start with one photo"), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-sm)",
      color: "var(--text-quiet)"
    }
  }, "Its song will live here.")) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
      gap: "var(--grid-gap)"
    }
  }, songs.map(s => /*#__PURE__*/React.createElement("div", {
    key: s.id
  }, /*#__PURE__*/React.createElement(SongCard, _extends({}, s, {
    playing: playing === s.id,
    onPlay: () => setPlaying(playing === s.id ? null : s.id),
    onOpen: () => onOpen(s)
  })), s.versions > 1 && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setExpanded(expanded === s.id ? null : s.id),
    style: {
      display: "flex",
      alignItems: "center",
      gap: 7,
      background: "none",
      border: "none",
      padding: 0,
      cursor: "pointer",
      font: "var(--ui-sm)",
      color: "var(--brass-200)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: expanded === s.id ? "chevron-down" : "chevron-right",
    size: 14
  }), s.versions, " versions"), expanded === s.id && /*#__PURE__*/React.createElement(Panel, {
    variant: "quiet",
    pad: 0,
    style: {
      marginTop: 8,
      overflow: "hidden"
    }
  }, [{
    n: "Version 3",
    d: "today · let it finish",
    cur: true
  }, {
    n: "Version 2",
    d: "12 March · remix"
  }, {
    n: "Original",
    d: "11 March"
  }].map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "10px 14px",
      borderTop: i ? "1px solid var(--border-hairline)" : "none",
      background: v.cur ? "var(--wash-1)" : "transparent"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: v.cur ? "disc-3" : "disc",
    size: 15,
    color: v.cur ? "var(--brass-200)" : "var(--ink-4)"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      font: "var(--ui-sm)",
      color: "var(--ink-1)"
    }
  }, v.n), /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-xs)",
      color: "var(--text-faint)"
    }
  }, v.d), /*#__PURE__*/React.createElement(IconButton, {
    icon: "play",
    label: "Play version",
    size: 30
  })))))))));
}
window.SanctuaryScreen = SanctuaryScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/SanctuaryScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/SettingsScreen.jsx
try { (() => {
const {
  Panel,
  Switch,
  Select,
  Button,
  Icon,
  Badge
} = window.StillsongDesignSystem_4faa75;
function Section({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      marginBottom: "var(--space-8)"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      font: "var(--ui-eyebrow)",
      letterSpacing: "var(--tracking-eyebrow)",
      textTransform: "uppercase",
      color: "var(--brass-300)",
      margin: "0 0 var(--space-5)"
    }
  }, title), children);
}
function SettingsScreen() {
  const [scroll, setScroll] = React.useState(true);
  const [contrast, setContrast] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      overflowY: "auto",
      padding: "var(--space-8) var(--gutter-screen) var(--space-9)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 640
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      font: "var(--display-md)",
      color: "var(--ink-1)",
      margin: "0 0 var(--space-8)",
      letterSpacing: "var(--tracking-display)"
    }
  }, "Stillsong"), /*#__PURE__*/React.createElement(Section, {
    title: "Settings"
  }, /*#__PURE__*/React.createElement(Panel, {
    pad: 20,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: "var(--space-6)"
    }
  }, /*#__PURE__*/React.createElement(Select, {
    label: "Quality of saved songs",
    value: "V0",
    options: [{
      value: "V0",
      label: "Best (V0)"
    }, {
      value: "V2",
      label: "Smaller files (V2)"
    }]
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: scroll,
    onChange: setScroll,
    label: "Gently scroll the lyrics while a song plays",
    hint: "An estimate \u2014 the words aren't timed to the music."
  }), /*#__PURE__*/React.createElement(Switch, {
    checked: contrast,
    onChange: setContrast,
    label: "Always use a solid panel behind lyrics",
    hint: "Turns on by itself when your system asks for more contrast."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      paddingTop: "var(--space-5)",
      borderTop: "1px solid var(--border-hairline)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--ui-md)",
      color: "var(--ink-1)"
    }
  }, "Where the pieces are kept"), /*#__PURE__*/React.createElement("div", {
    style: {
      font: "var(--mono-sm)",
      color: "var(--text-quiet)",
      marginTop: 3
    }
  }, "%LOCALAPPDATA%\\\\com.example.stillsong\\\\components\\\\")), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "sm"
  }, "Verify installation")))), /*#__PURE__*/React.createElement(Section, {
    title: "About"
  }, /*#__PURE__*/React.createElement(Panel, {
    variant: "quiet",
    pad: 20
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "300 30px/1 var(--font-display)",
      color: "var(--ink-1)"
    }
  }, "Stillsong"), /*#__PURE__*/React.createElement(Badge, {
    mono: true
  }, "1.0.0")), /*#__PURE__*/React.createElement("p", {
    style: {
      font: "var(--ui-md)",
      color: "var(--text-body)",
      margin: "var(--space-5) 0 0",
      maxWidth: "54ch"
    }
  }, "Stillsong never connects to the internet after setup. Your photos and songs stay on this computer."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "var(--space-7)",
      display: "flex",
      flexDirection: "column",
      gap: 6,
      font: "var(--ui-sm)",
      color: "var(--text-quiet)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      font: "var(--ui-label)",
      color: "var(--text-faint)",
      letterSpacing: ".04em"
    }
  }, "With thanks to"), /*#__PURE__*/React.createElement("span", null, "Music composed locally by ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-1)"
    }
  }, "MiniMax-Music3")), /*#__PURE__*/React.createElement("span", null, "Lyrics by ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-1)"
    }
  }, "Gemma")), /*#__PURE__*/React.createElement("span", null, "Engines: ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-1)"
    }
  }, "ComfyUI"), ", ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--ink-1)"
    }
  }, "llama.cpp"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: "var(--space-5)",
      marginTop: "var(--space-7)"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "scroll-text"
  }, "Licences"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "github"
  }, "Source"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "sm",
    icon: "folder-open"
  }, "Open logs folder"))))));
}
window.SettingsScreen = SettingsScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/SongScreen.jsx
try { (() => {
const {
  PhotoRoom,
  LyricSheet,
  Player,
  Notice,
  IconButton,
  Icon,
  Panel,
  Button,
  Dialog,
  Badge,
  Switch
} = window.StillsongDesignSystem_4faa75;
function SongScreen({
  song,
  onBack,
  onRemix,
  autoplay
}) {
  const [playing, setPlaying] = React.useState(!!autoplay);
  const [pos, setPos] = React.useState(autoplay ? 0 : 38);
  const [vol, setVol] = React.useState(.75);
  const [menu, setMenu] = React.useState(false);
  const [solid, setSolid] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setPos(p => Math.min(song.dur, p + 1)), 1000);
    return () => clearInterval(t);
  }, [playing, song]);
  return /*#__PURE__*/React.createElement(PhotoRoom, {
    photo: song.photo,
    luminance: song.lum,
    scrim: "vertical"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "18px 22px"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: "chevron-left",
    label: "Close",
    variant: "glass",
    onClick: onBack
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "shuffle",
    label: "Remix",
    variant: "glass",
    onClick: onRemix
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: "ellipsis",
    label: "More",
    variant: "glass",
    onClick: () => setMenu(!menu)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "flex",
      alignItems: "center",
      padding: "0 var(--gutter-screen)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 520,
      maxHeight: "100%",
      overflowY: "auto",
      paddingRight: 8
    }
  }, song.truncated && /*#__PURE__*/React.createElement(Notice, {
    tone: "calm",
    glass: true,
    action: "Let it finish",
    title: "This song wanted to run longer than expected",
    style: {
      marginBottom: "var(--space-6)",
      maxWidth: 420
    }
  }, "We can give it another half minute and keep everything else the same."), /*#__PURE__*/React.createElement(LyricSheet, {
    title: song.title,
    stanzas: song.stanzas,
    instrumental: song.instrumental,
    epigraph: song.instrumental ? song.caption.split(".")[0] + "." : null,
    mode: solid ? "solid" : "blur"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 var(--gutter-screen) 26px",
      display: "flex",
      alignItems: "center",
      gap: "var(--space-5)"
    }
  }, /*#__PURE__*/React.createElement(Player, {
    playing: playing,
    position: pos,
    duration: song.dur,
    volume: vol,
    onToggle: () => setPlaying(!playing),
    onSeek: setPos,
    onVolume: setVol,
    style: {
      flex: 1,
      maxWidth: 640
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "glass"
  }, song.genre), /*#__PURE__*/React.createElement(Switch, {
    checked: solid,
    onChange: setSolid,
    label: "Solid panel"
  }))), menu && /*#__PURE__*/React.createElement(Panel, {
    variant: "glass",
    pad: 6,
    style: {
      position: "absolute",
      top: 64,
      right: 22,
      width: 230
    }
  }, [["shuffle", "Remix this song"], ["download", "Save a copy…"], ["folder-open", "Reveal in folder"], ["pencil-line", "Rename"], ["disc", "View original version"], ["trash-2", "Delete"]].map(([ic, l]) => /*#__PURE__*/React.createElement("button", {
    key: l,
    onClick: () => {
      setMenu(false);
      if (l === "Delete") setConfirm(true);
      if (l === "Remix this song") onRemix();
    },
    style: {
      display: "flex",
      alignItems: "center",
      gap: 11,
      width: "100%",
      padding: "9px 10px",
      background: "none",
      border: "none",
      cursor: "pointer",
      font: "var(--ui-sm)",
      color: l === "Delete" ? "#E0A18B" : "var(--ink-1)",
      textAlign: "left",
      borderRadius: "var(--radius-sm)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: ic,
    size: 15
  }), l))), /*#__PURE__*/React.createElement(Dialog, {
    open: confirm,
    title: "Delete this song?",
    onClose: () => setConfirm(false),
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      onClick: () => setConfirm(false)
    }, "Keep it"), /*#__PURE__*/React.createElement(Button, {
      variant: "danger",
      onClick: () => setConfirm(false)
    }, "Delete"))
  }, "Your photo stays where it is. The song file will be removed from your computer.")));
}
window.SongScreen = SongScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/SongScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/stillsong-app/data.jsx
try { (() => {
const P = s => `https://picsum.photos/seed/${s}/1200/900`;
const SONGS = [{
  id: 1,
  photo: P("stillsong-harbour"),
  title: "Harbour, Nearly Dark",
  genre: "slow folk ballad",
  length: "2:14",
  dur: 134,
  date: "12 March",
  lum: .28,
  versions: 3,
  caption: "A small harbour at dusk, three boats tied up, the water almost still.",
  stanzas: ["The gate stays open all evening\nand the rain keeps its own time", "We counted the boats twice\nthen stopped counting\nand let the light go", "Nearly dark, nearly home —\nthe water holds what's left of the day"]
}, {
  id: 2,
  photo: P("stillsong-field"),
  title: "Long Field, Rain",
  genre: "quiet piano",
  length: "1:52",
  dur: 112,
  date: "9 March",
  lum: .74,
  caption: "A wet field at the edge of evening. Nothing moving but the weather.",
  instrumental: true
}, {
  id: 3,
  photo: P("stillsong-window"),
  title: "Winter Window",
  genre: "warm ambient",
  length: "2:41",
  dur: 161,
  date: "2 March",
  lum: .62,
  caption: "Frost on the inside of the glass, a mug going cold on the sill.",
  truncated: true,
  stanzas: ["Frost on the inside of the glass\nand your name in it, backwards", "I keep the kettle going\nfor a house with one person in it"]
}, {
  id: 4,
  photo: P("stillsong-kitchen"),
  title: "Kitchen, Late",
  genre: "slow soul",
  length: "3:02",
  dur: 182,
  date: "27 February",
  lum: .36,
  caption: "Two plates, one lamp, the radio down low.",
  stanzas: ["Two plates and one lamp on\nthe radio talking to nobody"]
}, {
  id: 5,
  photo: P("stillsong-road"),
  title: "The Road Out",
  genre: "folk waltz",
  length: "2:28",
  dur: 148,
  date: "21 February",
  lum: .55,
  caption: "A gravel road leaving town, hedges tall on both sides.",
  stanzas: ["Gravel and hedges and heat\nand the town getting smaller behind us"]
}, {
  id: 6,
  photo: P("stillsong-dog"),
  title: "Old Friend, Sleeping",
  genre: "lullaby",
  length: "1:47",
  dur: 107,
  date: "14 February",
  lum: .44,
  caption: "He sleeps in the one square of sun that reaches the rug.",
  instrumental: true
}];
window.SS_DATA = {
  SONGS
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/stillsong-app/data.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Icon = __ds_scope.Icon;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Panel = __ds_scope.Panel;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.LintList = __ds_scope.LintList;

__ds_ns.Notice = __ds_scope.Notice;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.CREATION_STAGES = __ds_scope.CREATION_STAGES;

__ds_ns.StageList = __ds_scope.StageList;

__ds_ns.Disclosure = __ds_scope.Disclosure;

__ds_ns.SegmentedChoice = __ds_scope.SegmentedChoice;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.TextField = __ds_scope.TextField;

__ds_ns.LyricSheet = __ds_scope.LyricSheet;

__ds_ns.PhotoRoom = __ds_scope.PhotoRoom;

__ds_ns.PhotoWell = __ds_scope.PhotoWell;

__ds_ns.Player = __ds_scope.Player;

__ds_ns.SongCard = __ds_scope.SongCard;

})();
