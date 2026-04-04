import {useLocation} from "react-router-dom";
import {useEffect, useState} from "react";

const REASONS = [
    {label: "Page not generated yet", detail: "CodePal hasn't built this route yet."},
    {label: "Mistyped URL", detail: "Double-check the path for typos."},
    {label: "Route not registered", detail: "The path may need to be added to the router."},
];

const NotFound = () => {
    const location = useLocation();
    const [mounted, setMounted] = useState(false);
    const [isDark, setIsDark] = useState(() =>
        window.matchMedia("(prefers-color-scheme: dark)").matches
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === "codepal:theme") {
                setIsDark(event.data.theme === "dark");
            }
        };
        window.addEventListener("message", handleMessage);

        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onMq = (e: MediaQueryListEvent) => setIsDark(e.matches);
        mq.addEventListener("change", onMq);

        return () => {
            window.removeEventListener("message", handleMessage);
            mq.removeEventListener("change", onMq);
        };
    }, []);

    useEffect(() => {
        console.error("404 — route not found:", location.pathname);
        setMounted(true);
    }, [location.pathname]);

    const c = isDark
        ? {
            bg: "#0a0a0a",
            card: "rgba(255,255,255,0.035)",
            cardBorder: "rgba(255,255,255,0.07)",
            cardHover: "rgba(255,255,255,0.055)",
            num: "rgba(255,255,255,0.06)",
            title: "rgba(255,255,255,0.88)",
            sub: "rgba(255,255,255,0.42)",
            muted: "rgba(255,255,255,0.28)",
            pathBg: "rgba(255,255,255,0.05)",
            pathBorder: "rgba(255,255,255,0.08)",
            pathText: "rgba(255,255,255,0.55)",
            divider: "rgba(255,255,255,0.06)",
            btnBg: "#1a1a1a",
            btnBorder: "rgba(255,255,255,0.1)",
            btnText: "rgba(255,255,255,0.75)",
            btnHoverBg: "#222",
            dot: "rgba(255,255,255,0.04)",
        }
        : {
            bg: "#ffffff",
            card: "rgba(0,0,0,0.02)",
            cardBorder: "rgba(0,0,0,0.06)",
            cardHover: "rgba(0,0,0,0.04)",
            num: "rgba(0,0,0,0.04)",
            title: "rgba(0,0,0,0.82)",
            sub: "rgba(0,0,0,0.42)",
            muted: "rgba(0,0,0,0.25)",
            pathBg: "rgba(0,0,0,0.03)",
            pathBorder: "rgba(0,0,0,0.07)",
            pathText: "rgba(0,0,0,0.5)",
            divider: "rgba(0,0,0,0.06)",
            btnBg: "#f5f5f5",
            btnBorder: "rgba(0,0,0,0.08)",
            btnText: "rgba(0,0,0,0.7)",
            btnHoverBg: "#eee",
            dot: "rgba(0,0,0,0.03)",
        };

    return (
        <div style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            background: c.bg,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            transition: "background 0.4s ease",
            overflow: "hidden",
        }}>
            {/* Subtle dot grid background */}
            <div style={{
                position: "absolute",
                inset: 0,
                backgroundImage: `radial-gradient(circle, ${c.dot} 1px, transparent 1px)`,
                backgroundSize: "28px 28px",
                opacity: mounted ? 1 : 0,
                transition: "opacity 1s ease",
            }}/>

            {/* Content */}
            <div style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                maxWidth: 400,
                padding: "32px 24px",
                opacity: mounted ? 1 : 0,
                transform: mounted ? "translateY(0)" : "translateY(8px)",
                transition: "opacity 0.6s ease, transform 0.6s ease",
            }}>
                {/* 404 number */}
                <div style={{
                    fontSize: 80,
                    fontWeight: 200,
                    letterSpacing: -3,
                    lineHeight: 1,
                    color: c.num,
                    userSelect: "none",
                }}>
                    404
                </div>

                {/* Title */}
                <h1 style={{
                    fontSize: 16,
                    fontWeight: 500,
                    color: c.title,
                    margin: "16px 0 6px",
                    letterSpacing: -0.3,
                }}>
                    Page not found
                </h1>

                {/* Subtitle with route */}
                <p style={{
                    fontSize: 13,
                    color: c.sub,
                    margin: 0,
                    textAlign: "center",
                    lineHeight: 1.5,
                }}>
                    No route matches{" "}
                    <code style={{
                        fontFamily: "'SF Mono', 'Fira Code', monospace",
                        fontSize: 11.5,
                        padding: "2px 6px",
                        borderRadius: 5,
                        background: c.pathBg,
                        border: `1px solid ${c.pathBorder}`,
                        color: c.pathText,
                    }}>
                        {location.pathname}
                    </code>
                </p>

                {/* Divider */}
                <div style={{
                    width: 32,
                    height: 1,
                    background: c.divider,
                    margin: "20px 0",
                    borderRadius: 1,
                }}/>

                {/* Reason cards */}
                <div style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    width: "100%",
                    marginBottom: 24,
                }}>
                    {REASONS.map((r) => (
                        <ReasonCard key={r.label} label={r.label} detail={r.detail} c={c}/>
                    ))}
                </div>

                {/* Home link */}
                <a
                    href="/"
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        padding: "8px 16px",
                        borderRadius: 8,
                        background: c.btnBg,
                        border: `1px solid ${c.btnBorder}`,
                        color: c.btnText,
                        fontSize: 13,
                        fontWeight: 500,
                        textDecoration: "none",
                        transition: "background 0.2s ease, border-color 0.2s ease",
                        cursor: "pointer",
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.background = c.btnHoverBg;
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.background = c.btnBg;
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5"/>
                        <path d="M12 19l-7-7 7-7"/>
                    </svg>
                    Back to home
                </a>
            </div>
        </div>
    );
};

/** Single reason row */
const ReasonCard = ({label, detail, c}: {
    label: string;
    detail: string;
    c: Record<string, string>;
}) => {
    const [hovered, setHovered] = useState(false);

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 8,
                background: hovered ? c.cardHover : c.card,
                border: `1px solid ${c.cardBorder}`,
                transition: "background 0.2s ease",
                cursor: "default",
            }}
        >
            <span style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: c.muted,
                flexShrink: 0,
                marginTop: 6,
            }}/>
            <div>
                <span style={{fontSize: 13, fontWeight: 500, color: c.title, letterSpacing: -0.1}}>
                    {label}
                </span>
                <span style={{fontSize: 12, color: c.sub, marginLeft: 6}}>
                    {detail}
                </span>
            </div>
        </div>
    );
};

export default NotFound;
