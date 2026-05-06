/* NetHack 5.0   g_win.h
 * Copyright (c) 2026 ModMyNetHack maintainers
 * NetHack may be freely redistributed.  See license for details.
 *
 * Window-system identifier globals, grouped.
 *
 * Migrated in-place 2026-05-06 from include/decl.h + src/decl.c.
 * The four `WIN_*` globals now live as fields of struct win_globals g_win;
 * existing call sites continue to compile thanks to the #define
 * shims below — &WIN_MAP, WIN_MAP = ..., and clear_nhwindow(WIN_MAP)
 * all still work, expanding to (g_win.WIN_MAP) at preprocess time.
 *
 * The CREATE_GLOBAL machinery in sys/libnh/libnhmain.c keeps
 * exposing these to JS as nethackGlobal.globals.WIN_MAP etc. — the
 * stringified macro arg is unchanged, only the address-of expansion
 * differs.
 */

#ifndef G_WIN_H
#define G_WIN_H

#include "wintype.h"   /* for winid typedef */

struct win_globals {
    winid WIN_MESSAGE;
    winid WIN_STATUS;
    winid WIN_MAP;
    winid WIN_INVEN;
};

extern struct win_globals g_win;

/* Compatibility shims so existing call sites compile unchanged. */
#define WIN_MESSAGE (g_win.WIN_MESSAGE)
#define WIN_STATUS  (g_win.WIN_STATUS)
#define WIN_MAP     (g_win.WIN_MAP)
#define WIN_INVEN   (g_win.WIN_INVEN)

#endif /* G_WIN_H */
