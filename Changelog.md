## Unreleased

### Added

- Option in **Display options** to show the current of the trace at the cursor
  position instead of at the pointer height. When zoomed out, the minimum,
  maximum, and average current at the cursor position are shown, together with
  the time range and number of samples they cover.

## 4.4.1 - 2026-06-10

### Fixed

- Issue where timestamps would be displayed with relative values in the chart
  even if absolute timestamps were selected.

## 4.4.0 - 2026-05-21

### Added

- Shortcut Alt+P (on Windows and Linux) and Option-P (on macOS) to toggle the
  power output of the Device Under Test.

### Fixed

- Issue with sending big, unneeded telemetry data for dependencies.
- MacOS-only issue where testing would stall during long sessions.

### Removed

- The PPK1 deprecation notice. PPK1 devices no longer show in the list of
  connected devices.

## 4.3.1 - 2025-08-13

### Fixed

- An issue where the Power Profiler's specific shortcuts were not listed in the
  shortcuts menu in the `About` tab.
- Issue with the loading of the PPK2 file caused by the disk space checker
  incorrectly using the decompression target.
- Issue with scenarios where session files would become unavailable during
  recovery operations.

## 4.3.0 - 2025-07-31

### Added

- Offset configuration feature that lets you define a pre-trigger data length to
  be recorded before the trigger.
- Support for analog trigger activation based on either the rising or falling
  edge.
- Digital Triggers and configurable trigger conditions based on digital channel
  states.
- Session recovery feature that lets you recover a session after a crash or an
  unexpected shutdown.

### Changed

- The expanded or collapsed state of device panel components is now persistent
  between the app sessions.

## 4.2.2 - 2025-05-22

### Changed

- Update dependencies to support the nRF Connect for Desktop v5.2.0 release.
- Updated Power Profiler Kit 2 firmware to v1.2.4. In this version, the data for
  the LDO offset calibration is now applied properly.

## 4.2.1 - 2024-11-11

### Changed

- Updated `nrfutil device` to v2.6.4.

### Fixed

- Floating point ranges in Advanced Configuration are now rounded correctly when
  initialized.

## 4.2.0 - 2024-07-17

### Changed

- Updated PPK2 firmware to v1.2.0, which adds COM port for shell access and
  improves stability and accuracy (in some scenarios).

### Fixed

- Deteriorating performance when selecting big samples on the chart.
- Selection windows states now updated data consistently after select all.
- Clear selection when loading PPK2 file.

## 4.1.3 - 2024-07-15

### Fixed

- Digital channels are now exported correctly to CSV files.

## 4.1.2 - 2024-06-20

### Fixed

- The digital channel will now render correctly after a short session.
- The chart now automatically detects the sample density on the chart and
  enables or disables point and snapping when changing the sampling rate.
- The selection windows now process all the selected data.
- The PPK1 deprecation dialog content now adapts to the screen windows size.

## 4.1.1 - 2024-05-30

### Added

- Support for Apple silicon.

## 4.1.0 - 2024-04-15

### Changed

- Moved feedback tab to a dialog which can be opened by going to the about tab
  and click **Give Feedback**.

### Fixed

- Chart frame throttling for slower machines.
- Clearing session files on close in some special cases.
- Behavior of **Disk full trigger** when recording for an indefinite period of
  time. It now correctly stops sampling when the disk is full.
- Starting sampling in the scope mode when the disk is full.

## 4.0.0 - 2024-03-13

### Added

- Reintroduced triggers functionality.
- Configuration in the advanced settings menu to stop saving to hard disk when
  the HDD space is running low.
- The default path for the session can be changed from the advanced settings
  menu.

### Changed

- Changed export format to `.ppk2`. `.ppk` has been deprecated and importing
  this format will autogenerate a `.ppk2` file next to the `.ppk` file.
- Removed limitations for recording duration by using the disk to store the
  collected data instead of using RAM.
- Performance improvements.
- The advanced settings menu are always visible on the side panel.

### Fixed

- Some cases when chart was drifting in the live mode.
- UI glitches.

## 4.0.0-beta6 - 2024-01-08

### Fixed

- Minor improvements to the stability of the chart rendering

## 4.0.0-beta5 - 2024-01-05

### Fixed

- Window average was off by a factor of 1000 when zoomed out
- Duplicate Azure insights event

## 4.0.0-beta4 - 2024-01-04

### Fixed

- Improved stability with chart processing
- Window stats drop to zeros when zoomed in and at the end of chart
- Window average was off by a factor of 1000
- Bit graph was rendering incorrectly when scrolling
- UI may become unresponsive when selecting a large window range such as select
  all

## 4.0.0-beta3 - 2023-12-14

### Changed

- Click and Drag Navigation:
    - Click and drag to scroll left or right (control xAxis) with yAxis locked
    - Hold `alt (option ⌥ - MAC)` unlocks yAxis and click and drag to scroll
      left or right (control xAxis) and up and down (control yAxis)
- Zoom Navigation:
    - Zoom with mouse wheel or track pad gesture to zoom on the xAxis with yAxis
      locked
    - Hold `alt (option ⌥ - MAC)` unlocks yAxis and zoom with mouse wheel or
      track pad gesture to zoom on the yAxis with xAxis locked
    - Hold `shift` while using track pad gesture to scroll will zoom xAxis with
      the yAxis locked
    - Hold `shift` and `alt (option ⌥ - MAC)` while using track pad gesture to
      scroll will zoom on the yAxis
- Track pad Panning:
    - Using track pad gesture to scroll with the yAxis locked
    - Hold `alt (option ⌥ - MAC)` unlocks yAxis and using track pad gesture to
      scroll with both axis unlocked

### Fixed

- Right click will now take you to end of the file/live mode

## 4.0.0-beta2 - 2023-12-12

### Added

- Feedback tab
- Persist state of `show log` panel

### Fixed

- Error when recording data exceed buffer size by one sample resulting in error
  in console.
- Window stats where off by a factor of 1000

## 4.0.0-beta1 - 2023-12-07

### Added

- Navigable minimap, which will display a zoomed-out map of the entire sample.
  In order to navigate the sample, simply click on the location where you want
  your window, or drag the slider in along the horizontal axis.
- Zoom to selection button, which will make the window the size of the selected
  area. Hotkey is ALT+Z.
- Option to toggle logarithmic scale on the Y Axis, by @danielkucera.

### Changed

- The Y axis settings are now moved into a dialog. To open the settings dialog,
  press SETTINGS, in the top left corner of the graph. The dialog contains the
  options to toggle linear or logarithmic scale, and the option to lock the Y
  axis.
- The chart will now only show positive values along the X axis.
- Backend for interacting with devices from **nrf-device-lib-js** to **nrfutil
  device**.

### Removed

- Support for Power Profiler Kit (PPK1). From this release, Power Profiler app
  will only be usable for Power Profiler Kit II (PPK2). In order to use a PPK1,
  use a version before v4.0.0 or replace the deprecated PPK1 with a PPK2.
  Removing support for PPK1 allows us to add new PPK2 features to the
  application.
- _Real-Time_ pane, as this was mainly intended for the deprecated PPK1. The
  useful Trigger feature will be re-introduced in the _Data Logger_ pane in an
  upcoming release.

### Fixed

- PPK2 would create noise in the measurement when the LED was pulsing (i.e.
  PWM), a new firmware (power_profiler_2 1_1_0) has been added and will make the
  LED static during sampling. The next time you connect to a PPK2 with an old
  firmware, you will be able to program it with the new version.
- When changing the sampling parameters in the side panel, after having done a
  sample, it would remove the sample data.
- Zooming further than what is permitted would cause the graph to pane. This is
  now restricted, which means that if zooming has reached its limit, you will
  need to explicitly pane the graph.
- Hovering the digital channels would show a horizontal line at the top of the
  graph. Now the horizontal line will only be shown together with the vertical
  line if you hover the graph.

## 3.5.5 - 2023-04-05

### Fixed

- Linux: Missing nrf-udev installation resulted in the app crashing.

### Known Issue

- PPK1: Does not work in nRF Connect for Desktop v4.0.1, but will be fixed in
  the next patch release v4.0.2. In order to work with the PPK1, try downgrading
  nRF Connect for Desktop to v4.0.0.

## 3.5.4 - 2023-02-12

### Added

- Auto reconnect functionality.

### Changed

- Update to work with nRF Connect for Desktop v4.0.0.

### Fixed

- Issue in `Real Time` pane, where if you increased the `Length`, the length
  would not be reflected in the window of the next trigger.

## 3.5.3 - 2022-11-28

### Changed

- New PPK2 firmware. The first time you connect a PPK2 with an older firmware
  version, you will be asked if you want your device to be programmed.

## 3.5.2 - 2022-10-12

### Fixed

- PPK2 did not show up in **Device Selector** when the appropriate firmware was
  not flashed. This release removes the filtering that was introduced in v3.5.0.

## 3.5.1 - 2022-10-5

### Fixed

- Resuming profiling used to crash.

## 3.5.0 - 2022-09-26

### Known Issue

- PPK1 measurements may fail after some time with error message: "Corrupt data
  detected, please check connection to PPK". A temporary solution, that we have
  tested, is to manually downgrade JLink firmware on the device to v7.58b.

### Added

- Device filter
    - When using a PPK2 you should only select the PPK2 in this app.
    - When using a PPK1 you can use it with any member of the nRF51, nRF52 or
      nRF53 Family.

### Changed

- Better performance when paning large datasets

## 3.4.5 - 2022-09-07

### Fixed

- Toggle buttons in off-state are now visible toggles.
- Did not display all serialport devices.

## 3.4.4 - 2022-09-05

### Added

- API support for nRF Connect for Desktop v3.12.0

## 3.4.3 - 2022-03-24

### Fixed

- App no longer freezes for a long time after it has been sampling in the
  background for a longer period of time.
- Loading csv files is now restricted depending on the application's
  architecture.

## 3.4.2 - 2022-02-17

### Fixed

- Loading larger files are now supported.

## 3.4.1 - 2022-02-10

### Added

- Option to select entire set of samples by pressing `ALT + a` or clicking the
  `SELECT ALL` button in bottom right corner.

### Fixed

- Selection is not removed when returning to Live View.
- Export all now works for all new samples.
    - If you are not able to use export `All` with an older set of samples
      (loaded from a .ppk file), you may use `SELECT ALL` and export selection
      instead.

## 3.4.0 - 2022-02-03

### Added

- Manually setting y-axis range is now available when `LOCK Y-AXIS` is toggled.
- Export dialog now have a section to choose what selection to export to CSV.
    - The different options are to export 'All' samples, the samples within the
      'Window', or a 'Selection'.
    - The option for 'Selection' is only present if an area of the profile is
      selected.

### Changed

- Added icons to Start/Stop buttons in `Real Time` pane.
- Save / Export is now available after deselecting device
    - Be aware that if you select device again the unsaved samples will be wiped

## 3.3.0 - 2021-12-15

### Changed

- Advanced option to adjust buffer size is now available, which enables longer
  sampling time.
    - To display advanced options in the sidebar press `ctrl+alt+shift+a`.
- Advanced option to limit supply voltage under _Source Meter_ now available.
- Updated app icon.
- Added icons to Start/Stop buttons in `Data Logger` pane.

## 3.2.1 - 2021-11-30

### Fixed

- Issue where certain `.ppk` files could not be loaded.

## 3.2.0 - 2021-11-01

### Changed

- Establish compatibility with nRF Connect for Desktop 3.8.

## 3.1.3 - 2021-09-21

### Fixed

- Two corrupted samples in a row caused all future samples to be corrupt. This
  would be especially likely to happen in long running sessions.

## 3.1.2 - 2021-06-14

### Fixed

- Chart issues when loading from saved capture file.

## 3.1.1 - 2021-03-10

### Fixed

- CSV export had an inverted bit sequence.

## 3.1.0 - 2021-02-15

### Added

- Split the primary view in two, a **data logger** and a **real-time** view.
  With the data logger view the user can examine the power continuously over a
  period of time. In the real-time view, which has similar functionality to an
  oscilloscope, the user can specify a trigger level, and when the consumed
  power reaches this threshold, the power consumption signature in the
  surrounding period of time can be inspected in detail.
- **Trigger**: Previously only available when using the
  [older, first version of the Power Profiler Kit hardware](https://www.nordicsemi.com/Software-and-tools/Development-Tools/Power-Profiler-Kit)
  now triggers can also be set when using the new
  [Power Profiler Kit II (PPK2) hardware](https://www.nordicsemi.com/Software-and-tools/Development-Tools/Power-Profiler-Kit-2).
- Only with the PPK2: Set a **pre or post trigger** by moving the slider above
  the graph, to decide how much time before and after the trigger is relevant
  and will be shown for the next trigger.
- Average sampling with a lower resolution: When interested in **examining power
  over a longer time span** you can lower the samples per second. Sampling is
  still done at the full resolution, but automatically averaged to decrease the
  storage size. The rate can be lowered as far as only a sample per second,
  enabling sampling for days or even months.
- Besides the existing CSV export: **Save** the current data in a format to
  **Load** it again later within the app, enabling sharing data and examining it
  at a later time.
- Easily create **screenshots** of the current graph.

### Changed

- Raise **limit for displaying digital channels** (on the highest resolution
  they were previously only shown for a time range of up to 3 seconds, now they
  are shown for up to 30 seconds).
- **Enhanced performance** to make the UI more responsive.
- Several **minor UI changes** to improve the user experience.

## 3.0.3 - 2020-12-11

### Fixed

- Small visual glitch when used with nRF Connect for Desktop 3.6.1: The top
  margin in the side panel was shrunken.

## 3.0.2 - 2020-12-11

### Fixed

- CSV export contained the wrong portion of data.

## 3.0.1 - 2020-12-03

### Fixed

- Connecting a PPK via J-Link Lite failed.
- Moving the right handle past the left handle in the chart selection would
  break the values displayed in the selection window.

## 3.0.0 - 2020-12-01

### Changed

- Complete rewrite of the application. This version supports the old power
  profiler kit, in addition to the newly released PPK2 hardware.
