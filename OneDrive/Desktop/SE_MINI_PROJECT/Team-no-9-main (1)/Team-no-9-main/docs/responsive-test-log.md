# Responsive UI Test Log (PWM-NF-004 / TC-UX-01)

Issue: #25 · Owner: Shikshith V · Breakpoints: 360px (base), 768px, 1280px (SAD 4.7)

## How to run

```
cd frontend
npx playwright install chromium   # first time only
npm run test:e2e
```

The automated suite (`frontend/e2e/*.spec.js`) opens each screen at 360, 768 and 1280 px, including its
empty, error and "please log in again" states. In each case it checks that:

- the page has no horizontal scroll;
- no element inside the page extends past the screen edge;
- the figures shown are correct;
- no text is smaller than 12px (dashboard);
- interactive parts (allocation legend, trend chart) can be used with the keyboard.

The trend chart is also checked with its tooltip open at the left edge, the middle and the right edge.

## Screens covered

| Screen | 360px | 768px | 1280px | Notes |
|---|---|---|---|---|
| Dashboard: net worth (#15) | Pass | Pass | Pass | Automated |
| Dashboard: allocation chart (#16) | Pass | Pass | Pass | Automated |
| Dashboard: stale / empty / error states | Pass | Pass | Pass | Automated |
| Dashboard: net-worth trend (#17) | Pass | Pass | Pass | Automated, including the tooltip at both edges and keyboard reading |
| Dashboard: trend empty / error / "log in again" states | Pass | Pass | Pass | Automated |
| Top navigation | Pass | Pass | Pass | Scrolls inside its own strip at 360px (by design) |
| Assets: real estate list (#12) | Pass | Pass | Pass | Automated. 1, 2 and 3 cards per row |
| Assets: update value form, with an inline error (#12) | Pass | Pass | Pass | Automated, single column at every width |
| Assets: value saved confirmation (#12) | Pass | Pass | Pass | Automated, with a ₹1,23,45,67,890.50 value |
| Assets: valuation history (#12) | Pass | Pass | Pass | Automated, 4 rows |
| Assets: 403 / 404 / "log in again" / empty states (#12) | n/a | n/a | Pass | Automated at 1280px only; simple text cards like the dashboard notices |
| Add / edit / delete asset forms | n/a | n/a | n/a | Not built yet (asset issues). Retest when they are merged. |
| Login (placeholder, #32) | Pass | Pass | Pass | Automated. Sign-in itself isn't wired up until the auth API exists |
| Forgot password: form, inline error, "check your email" (#32) | Pass | Pass | Pass | Automated |
| Reset password: form with errors, success, expired link (#32) | Pass | Pass | Pass | Automated; invalid / used links share the expired-link layout |
| Register | n/a | n/a | n/a | Not built yet (auth issues). Retest when it is merged. |

Browsers: Chromium tested automatically. Firefox, Safari and Edge still need a manual pass, as TC-UX-01 requires.
Dark mode was checked at 360px and 1280px (Sprint 2, by screenshot: dashboard with the trend chart and asset
screens at both widths; login, forgot and reset password screens at 360px).

## Issues found and how they were resolved

| # | Width | Issue | Resolution |
|---|---|---|---|
| 1 | 360px | The four nav links (Dashboard, Assets, Reports, Settings) don't fit on one line and would widen the page. | The nav scrolls sideways inside its own strip (`.nav { overflow-x: auto }`), so the page itself never scrolls. This matches SAD 4.7: content may scroll in its own container. |
| 2 | 360px | Large net-worth values (₹1,03,45,000.00 and above) could overflow the card at a fixed 40px font size. | The font size scales with screen width (`clamp(1.75rem, 8vw, 2.5rem)`), and `overflow-wrap: anywhere` is a fallback for very large values. |
| 3 | 360px | In the legend, the label, rupee value and percentage on one row were cramped and wrapped unpredictably. | Below 768px the rupee value moves to a second line under the label. At 768px and up it's a single row. |
| 4 | 768–1279px | Putting the two cards side by side at tablet width squeezed the donut and legend too much. | The cards stay stacked until 1280px, and the allocation card switches to donut-beside-legend from 768px. |
| 5 | All | Grid children with long numbers could push the grid wider than the screen (CSS grid items default to `min-width: auto`). | Grid columns use `minmax(0, 1fr)` and cards have `min-width: 0`. |
| 6 | All | With no assets, the card read "₹0 across 0 asset classes". | The card shows "No assets added yet", and the chart shows an empty-state message. |
| 7 | All | Nav links and the "Try again" button were below a comfortable tap size on phones. | Minimum height set to 40px. |
| 8 | 360px | A chart scaled down with an SVG `viewBox` shrinks its axis text with it, to about 6px on a phone. | The trend chart is drawn at the card's real pixel width (measured with `ResizeObserver`), so axis labels stay 12px at every width. On phones it is shorter (200px instead of 260px) and shows 3 date labels instead of 6. |
| 9 | 360px | A tooltip centred on the hovered day would stick out of the card near the left and right edges. | The tooltip opens to the right of points in the left third, to the left of points in the right third, and centred otherwise. The e2e test opens it at both edges at every width. |
| 10 | 360px | The value-axis labels (₹1.1 Cr, ₹0.95 Cr …) need different widths, and a fixed left margin either clipped them or wasted space. | The left margin is computed from the longest label. |
| 11 | All | On the 1Y and All ranges the date labels read "Oct 25", which looks like 25 October next to the "19 Oct" labels of the 1M range. Found in the screenshot review. | Month labels use the four-digit year ("Oct 2025"). |
| 12 | All (dark) | The selected range button (1M / 6M / 1Y / All) was hard to tell apart from the others in dark mode. Found in the screenshot review. | The selected button uses the same accent background as the current nav link. |
| 13 | All | On the update value form, pressing Save first blurred the field, and the check that ran on blur showed the error line. That pushed the Save button about 20px down before the mouse was released, so the click was lost and the form never submitted. Found by the e2e test. | The value is checked on submit and then on every keystroke, never on blur, so the button doesn't move during a click. |
| 14 | 360px | A history table with separate Date, Value, Change and Source columns doesn't fit a phone without scrolling. | The change from the previous valuation is shown in small text under the value, so three columns fit at 360px, even with a 15-character rupee amount. |
| 15 | 1280px | The form and history pages (max 720px wide) were centred, so their left edge didn't line up with the logo and the rest of the app. Found in the screenshot review. | Their content keeps the 720px cap but is left-aligned with the page. |
| 16 | All | The default light-grey border (#e3e6ec) made text fields almost invisible on white, below the 3:1 contrast that form controls need. | Inputs use a darker `--input-border` token in both light and dark mode. |
| 17 | All | Every property card has links named "Update value" and "History", which a screen reader lists as identical links. | Each link has hidden text with the property name ("Update value of Apartment, Whitefield"). |
| 18 | 360px | The "Password" label and the "Forgot password?" link share one row; with larger text settings they no longer fit side by side. | The row wraps, so the link drops under the label instead of overflowing. |
| 19 | 360px | On phones a narrow submit button under a form is easy to miss with a thumb. | Submit buttons on the login, forgot and reset screens span the full width of the card. |
