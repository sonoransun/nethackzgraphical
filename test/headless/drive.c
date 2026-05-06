/* Headless test harness for ModMyNetHack.
 *
 * Links against libnh.a (built with WANT_LIBNH=1, see sys/unix/hints/linux.500
 * line 384 onwards) and the winshim port. Registers a C callback that
 * feeds scripted keystrokes from a scenario file and tallies the
 * window-proc calls the engine makes back. Exits non-zero on failure
 * (engine never called print_glyph, scenario didn't reach EOF, etc.).
 *
 * Scenario file format:
 *   # comment
 *   key <ascii>          — 1-character literal, e.g. `key l`
 *   keynum <decimal>     — codepoint, e.g. `keynum 27` for ESC
 *   click <x> <y>        — mouse click at cell (x, y), CLICK_1
 *   ans  <ascii>         — answer the next yn_function with this char
 *   line <text...>       — answer the next getlin with this text
 *   expect <substring>   — fail unless at least one putstr/raw_print
 *                          since the last `expect` contained <substring>
 *   require_glyphs <n>   — fail if the engine called print_glyph fewer
 *                          than <n> times in total (run-cumulative)
 *
 * Usage:
 *   ./drive scenarios/walk-east-10.txt
 *
 * The harness expects HACKDIR to be set in the environment (or compiled
 * via -DHACKDIR=...). `make check-headless` sets it for you.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <stdint.h>
#include <ctype.h>

/* Symbols provided by libnh.a + winshim */
extern int nhmain(int argc, char *argv[]);
typedef void (*shim_callback_t)(const char *name, void *ret_ptr, const char *fmt, ...);
extern void shim_graphics_set_callback(shim_callback_t cb);

/* Scenario state ------------------------------------------------------- */

typedef enum {
    DIR_KEY,
    DIR_KEYNUM,
    DIR_CLICK,
    DIR_ANSWER,
    DIR_LINE,
    DIR_EXPECT,
    DIR_REQUIRE_GLYPHS,
} dir_kind_t;

typedef struct {
    dir_kind_t kind;
    int        i1, i2;       /* key code, click x, click y, codepoint */
    char       text[256];    /* expect substring / line content */
} directive_t;

#define MAX_DIRECTIVES 4096

static directive_t scenario[MAX_DIRECTIVES];
static int         scenario_len = 0;
static int         cursor       = 0;

/* Tally of window-proc calls the engine made */
static long        n_print_glyph = 0;
static long        n_nhgetch     = 0;
static long        n_exit        = 0;
static int         failed        = 0;

/* Buffer for tracking putstr/raw_print messages between `expect`s */
static char        recent_msgs[8192];
static size_t      recent_msgs_len = 0;

static void recent_clear(void) {
    recent_msgs_len = 0;
    recent_msgs[0]  = '\0';
}

static void recent_append(const char *s) {
    if (!s) return;
    size_t n = strlen(s);
    if (recent_msgs_len + n + 2 >= sizeof recent_msgs) recent_clear();
    memcpy(recent_msgs + recent_msgs_len, s, n);
    recent_msgs_len += n;
    recent_msgs[recent_msgs_len++] = '\n';
    recent_msgs[recent_msgs_len]   = '\0';
}

/* Scenario loading ----------------------------------------------------- */

static char *trim(char *s) {
    while (*s == ' ' || *s == '\t') s++;
    char *end = s + strlen(s);
    while (end > s && (end[-1] == ' ' || end[-1] == '\t' || end[-1] == '\n' || end[-1] == '\r'))
        end--;
    *end = '\0';
    return s;
}

static int load_scenario(const char *path) {
    FILE *f = fopen(path, "r");
    if (!f) {
        fprintf(stderr, "drive: cannot open %s\n", path);
        return -1;
    }
    char buf[1024];
    int line = 0;
    while (fgets(buf, sizeof buf, f)) {
        line++;
        char *p = trim(buf);
        if (*p == '\0' || *p == '#') continue;
        if (scenario_len >= MAX_DIRECTIVES) {
            fprintf(stderr, "drive: too many directives (>%d)\n", MAX_DIRECTIVES);
            fclose(f);
            return -1;
        }
        directive_t *d = &scenario[scenario_len];
        memset(d, 0, sizeof *d);

        if (strncmp(p, "key ", 4) == 0) {
            d->kind = DIR_KEY;
            d->i1   = (unsigned char)p[4];
        } else if (strncmp(p, "keynum ", 7) == 0) {
            d->kind = DIR_KEYNUM;
            d->i1   = atoi(p + 7);
        } else if (strncmp(p, "click ", 6) == 0) {
            d->kind = DIR_CLICK;
            sscanf(p + 6, "%d %d", &d->i1, &d->i2);
        } else if (strncmp(p, "ans ", 4) == 0) {
            d->kind = DIR_ANSWER;
            d->i1   = (unsigned char)p[4];
        } else if (strncmp(p, "line ", 5) == 0) {
            d->kind = DIR_LINE;
            strncpy(d->text, p + 5, sizeof d->text - 1);
        } else if (strncmp(p, "expect ", 7) == 0) {
            d->kind = DIR_EXPECT;
            strncpy(d->text, p + 7, sizeof d->text - 1);
        } else if (strncmp(p, "require_glyphs ", 15) == 0) {
            d->kind = DIR_REQUIRE_GLYPHS;
            d->i1   = atoi(p + 15);
        } else {
            fprintf(stderr, "drive: %s:%d unknown directive: %s\n", path, line, p);
            fclose(f);
            return -1;
        }
        scenario_len++;
    }
    fclose(f);
    return 0;
}

/* Get the next non-input directive (expect / require_glyphs); process
 * inline. Returns the next directive that requires user input (or NULL
 * if scenario exhausted). */
static directive_t *next_input_directive(void) {
    while (cursor < scenario_len) {
        directive_t *d = &scenario[cursor];
        if (d->kind == DIR_EXPECT) {
            if (!strstr(recent_msgs, d->text)) {
                fprintf(stderr, "FAIL expect: \"%s\" not seen in recent messages.\n",
                        d->text);
                fprintf(stderr, "Recent messages:\n%s\n", recent_msgs);
                failed = 1;
            }
            recent_clear();
            cursor++;
        } else if (d->kind == DIR_REQUIRE_GLYPHS) {
            if (n_print_glyph < d->i1) {
                fprintf(stderr, "FAIL require_glyphs: only %ld observed (need %d).\n",
                        n_print_glyph, d->i1);
                failed = 1;
            }
            cursor++;
        } else {
            return d;
        }
    }
    return NULL;
}

/* Window-proc callback ------------------------------------------------- */

static void cb(const char *name, void *ret_ptr, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);

    /* Tally calls and route inputs by callback name. */
    if (strcmp(name, "shim_print_glyph") == 0) {
        n_print_glyph++;
    } else if (strcmp(name, "shim_putstr") == 0) {
        /* args: winid w, int attr, const char *str */
        (void)va_arg(ap, void *);   /* winid (i, passed by value) */
        (void)va_arg(ap, void *);   /* attr  (i, passed by value) */
        const char *str = va_arg(ap, const char *);
        recent_append(str);
    } else if (strcmp(name, "shim_raw_print") == 0 ||
               strcmp(name, "shim_raw_print_bold") == 0) {
        const char *str = va_arg(ap, const char *);
        recent_append(str);
    } else if (strcmp(name, "shim_nhgetch") == 0) {
        n_nhgetch++;
        directive_t *d = next_input_directive();
        int ch;
        if (!d) {
            ch = 27;        /* ESC to gracefully unwind any prompt loops */
        } else if (d->kind == DIR_KEY || d->kind == DIR_KEYNUM) {
            ch = d->i1; cursor++;
        } else {
            /* Mismatched directive — feed ESC and complain. */
            fprintf(stderr, "WARN nhgetch encountered non-key directive at cursor %d\n", cursor);
            ch = 27; cursor++;
        }
        if (ret_ptr) *(int *)ret_ptr = ch;
    } else if (strcmp(name, "shim_nh_poskey") == 0) {
        n_nhgetch++;
        /* args: coordxy *x, coordxy *y, int *mod  (all out-pointers) */
        signed char *xp = va_arg(ap, signed char *);
        signed char *yp = va_arg(ap, signed char *);
        int *modp       = va_arg(ap, int *);
        directive_t *d = next_input_directive();
        int ret;
        if (!d) {
            ret = 27;
        } else if (d->kind == DIR_KEY || d->kind == DIR_KEYNUM) {
            ret = d->i1; cursor++;
        } else if (d->kind == DIR_CLICK) {
            if (xp)   *xp   = (signed char)d->i1;
            if (yp)   *yp   = (signed char)d->i2;
            if (modp) *modp = 1;     /* CLICK_1 */
            ret = 0;
            cursor++;
        } else {
            ret = 27;
            cursor++;
        }
        if (ret_ptr) *(int *)ret_ptr = ret;
    } else if (strcmp(name, "shim_yn_function") == 0) {
        /* args: const char *query, const char *resp, char def */
        (void)va_arg(ap, const char *);
        (void)va_arg(ap, const char *);
        int defv = va_arg(ap, int);
        directive_t *d = next_input_directive();
        int ch = defv;
        if (d && d->kind == DIR_ANSWER) { ch = d->i1; cursor++; }
        else if (d && (d->kind == DIR_KEY || d->kind == DIR_KEYNUM)) { ch = d->i1; cursor++; }
        if (ret_ptr) *(char *)ret_ptr = (char)ch;
    } else if (strcmp(name, "shim_getlin") == 0) {
        /* args: const char *query, char *bufp */
        (void)va_arg(ap, const char *);
        char *bufp = va_arg(ap, char *);
        directive_t *d = next_input_directive();
        const char *line = "";
        if (d && d->kind == DIR_LINE) { line = d->text; cursor++; }
        if (bufp) {
            strncpy(bufp, line, 255);
            bufp[255] = '\0';
        }
    } else if (strcmp(name, "shim_exit_nhwindows") == 0) {
        n_exit++;
    }

    va_end(ap);

    /* Default-zero return for callbacks we don't explicitly handle.
     * The shim_procs vtable in winshim.c declares each callback's
     * return type; on the C side ret_ptr points to that type's slot
     * which the shim's macro initializes to 0 already, so doing
     * nothing here is safe for callbacks we don't override. */
    (void)ret_ptr;
}

/* Main ----------------------------------------------------------------- */

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s <scenario.txt> [extra nh args...]\n", argv[0]);
        return 2;
    }
    if (load_scenario(argv[1]) != 0) return 2;

    shim_graphics_set_callback(cb);

    /* Pass any remaining argv onward to nethack. We always include
     * --version-short so the harness doesn't try to enter its menu
     * from stdin; the scenario takes over input handling once the
     * engine starts calling shim_nhgetch. */
    char *nh_argv[16];
    int nh_argc = 0;
    nh_argv[nh_argc++] = argv[0];
    for (int i = 2; i < argc && nh_argc < 15; i++)
        nh_argv[nh_argc++] = argv[i];

    int rc = nhmain(nh_argc, nh_argv);

    /* Process any remaining expect/require_glyphs directives that
     * didn't trigger an input request. */
    while (next_input_directive() != NULL) cursor++;

    fprintf(stderr,
            "drive: scenario=%s n_print_glyph=%ld n_nhgetch=%ld n_exit=%ld nhmain_rc=%d\n",
            argv[1], n_print_glyph, n_nhgetch, n_exit, rc);

    if (failed) return 1;
    if (n_print_glyph == 0) {
        fprintf(stderr, "FAIL: engine never called print_glyph (no rendering happened)\n");
        return 1;
    }
    return 0;
}
