/* NetHack 5.0   g_term.h
 * Copyright (c) 2026 ModMyNetHack maintainers
 * NetHack may be freely redistributed.  See license for details.
 *
 * Status (2026-05-06): NOT a separate struct.
 *
 * Originally this was scaffolding for a g_term migration. On
 * investigation the target globals were already migrated by upstream
 * into the existing instance_globals_t struct (`gt`), accessed as
 * `gt.tc_gbl_data.tc_AS` etc. via the AS/AE/LI/CO macros in decl.h.
 *
 * The vestigial standalone `extern struct tc_gbl_data tc_gbl_data;`
 * in decl.h was removed (it had no matching definition; the symbol
 * never linked anywhere meaningful). The struct *type* definition
 * remains in decl.h so tcap.h continues to find it.
 *
 * If a future PR wants to rename `gt` to `g_term` for clarity, the
 * mechanical recipe is in include/g_win.h's history. Until then this
 * file is a no-op for compatibility with anyone who #include'd it.
 */

#ifndef G_TERM_H
#define G_TERM_H
/* intentionally empty — see comment above */
#endif
