/* NetHack 5.0   g_classes.h
 * Copyright (c) 2026 ModMyNetHack maintainers
 * NetHack may be freely redistributed.  See license for details.
 *
 * Status (2026-05-06): NOT a separate struct.
 *
 * Originally this was scaffolding for a g_classes migration covering
 * monsyms[], oc_syms[], tune[], yn_number. On investigation:
 *
 *   • monsyms[]/oc_syms[] — the standalone externs were vestigial with
 *     no matching definitions. The active per-game symbol tables live
 *     in gs.showsyms / gp.primary_syms / gr.rogue_syms (see
 *     src/symbols.c). The vestigial externs were removed from decl.h
 *     and nothing failed to link.
 *
 *   • tune[] — the active per-game tune lives in svt.tune. The
 *     standalone extern was vestigial; one bug (dungeon.c using
 *     `sizeof tune` instead of `sizeof svt.tune`) was fixed in the
 *     same commit.
 *
 *   • yn_number — genuinely standalone, kept as-is in decl.c.
 *     Migrating it alone wouldn't justify a struct.
 *
 * If a future PR wants a g_classes struct for cleanliness, it can
 * fold yn_number plus any future leaf scalars into it. For now this
 * header is a no-op.
 */

#ifndef G_CLASSES_H
#define G_CLASSES_H
/* intentionally empty — see comment above */
#endif
