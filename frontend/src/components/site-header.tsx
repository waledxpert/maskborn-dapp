"use client";

import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ConnectModal } from "@/components/connect-modal";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useSessionStore } from "@/store/session";

const navItems = [
  { href: "/", label: "Home", primary: true },
  { href: "/collection", label: "Collection", primary: false },
  { href: "/gallery", label: "Gallery", primary: true },
  { href: "/draw", label: "Draw", primary: false },
  { href: "/apply", label: "Apply", primary: true },
  { href: "/community", label: "Community gallery", primary: false },
  { href: "/agents", label: "Agents", primary: true },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [compact, setCompact] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [navHovered, setNavHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [createAccountFlow, setCreateAccountFlow] = useState(false);
  const localTwitter = useSessionStore((state) => state.twitter);
  const session = useCurrentUser();
  const xAccount = session.data?.user?.socialAccounts.find((account) => account.provider === "X_MANUAL");
  const discordVerified = session.data?.user?.socialAccounts.some(
    (account) => account.provider === "DISCORD" && account.verificationState === "VERIFIED",
  ) ?? false;
  const twitter = xAccount?.username
    ? `@${xAccount.username}`
    : localTwitter;
  const visibleNavItems = session.data?.user?.role === "ADMIN"
    ? [...navItems, { href: "/mboadmin", label: "Admin", primary: false }]
    : navItems;

  useMotionValueEvent(scrollY, "change", (value) => setCompact(value > 90));

  useEffect(() => {
    const openConnect = () => {
      setCreateAccountFlow(false);
      setConnectOpen(true);
    };
    window.addEventListener("maskborn:connect", openConnect);
    return () => window.removeEventListener("maskborn:connect", openConnect);
  }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("connect") !== "create") return;
    window.history.replaceState({}, "", window.location.pathname);
    const timer = window.setTimeout(() => {
      setCreateAccountFlow(true);
      setConnectOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 800px)");
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const collapsed = mobile || (compact && !navHovered);

  return (
    <>
      <motion.header
        className="site-header"
        initial={{ y: -28, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        <motion.nav
          className="nav-capsule"
          animate={{
            width: mobile
              ? "min(590px, calc(100vw - 138px))"
              : collapsed
                ? "min(610px, calc(100vw - 160px))"
                : "min(940px, calc(100vw - 160px))",
          }}
          transition={{ type: "spring", stiffness: 260, damping: 28 }}
          aria-label="Main navigation"
          onMouseEnter={() => setNavHovered(true)}
          onMouseLeave={() => setNavHovered(false)}
          onFocus={() => setNavHovered(true)}
        >
          <Link className="wordmark" href="/" aria-label="Mask Born Order home">
            MB<span>O</span>
          </Link>
          <div className="nav-links">
            {visibleNavItems.map((item) => (
              <AnimatePresence key={item.href} initial={false}>
                {(!collapsed || item.primary) && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                  >
                    <Link suppressHydrationWarning className={pathname === item.href ? "active" : ""} href={item.href}>
                      {item.label}
                    </Link>
                  </motion.div>
                )}
              </AnimatePresence>
            ))}
          </div>
          <AnimatePresence>
            {mobile && (
              <motion.button
                className="menu-trigger"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => setMenuOpen((value) => !value)}
                aria-expanded={menuOpen}
              >
                {menuOpen ? <X size={16} /> : <Menu size={16} />} Menu
              </motion.button>
            )}
          </AnimatePresence>
        </motion.nav>
        <button className="connect-button" onClick={() => {
          setCreateAccountFlow(false);
          setConnectOpen(true);
        }}>
          <span className={discordVerified ? "status-dot online" : "status-dot"} />
          {discordVerified ? (twitter?.replace("@", "") ?? "Discord linked") : (twitter ? "Verify" : "Connect")}
        </button>
      </motion.header>

      <AnimatePresence>
        {menuOpen && mobile && (
          <motion.div
            className="nav-drawer"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
          >
            {visibleNavItems.map((item, index) => (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                <span>0{index + 1}</span>{item.label}
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <ConnectModal
        key={createAccountFlow ? "create-account" : "connect"}
        open={connectOpen}
        startCreatingAccount={createAccountFlow}
        onClose={() => {
          setConnectOpen(false);
          setCreateAccountFlow(false);
        }}
      />
    </>
  );
}
