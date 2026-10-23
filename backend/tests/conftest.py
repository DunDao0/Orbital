import os


def pytest_sessionfinish(session, exitstatus):
    if os.environ.get("ORBIS_REQUIRE_COMPLETE_TESTS") == "1":
        reporter = session.config.pluginmanager.get_plugin("terminalreporter")
        if reporter is None:
            # Without execution statistics there is no evidence of completeness.
            session.exitstatus = 1
        elif reporter.stats.get("skipped") or reporter.stats.get("deselected"):
            reporter.write_sep("!", "Complete scientific gate rejects skipped or deselected tests")
            session.exitstatus = 1
