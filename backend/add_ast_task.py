import asyncio
import sys
from backend.config import TaskConfig, ScanConfig, AstRule, AstNodePattern, TaskSchedule, TaskAction
from backend.storage import config_loader

async def add_ast_security_scanner_task():
    print("Attempting to add AST Security Scanner task...")

    # Define the AST Security Scanner task configuration
    ast_security_scanner_task = TaskConfig(
        id="ast-security-scan",
        name="AST Security Scanner",
        description="AST-based security scanning for hardcoded secrets and dangerous functions",
        active=True,
        connection="my-project",  # Assuming 'my-project' connection exists
        schedule=TaskSchedule(cron="0 9 * * *", timezone="UTC"),
        scan=ScanConfig(
            mode="full",
            type="ast-pattern",
            paths={
                "include": ["**/*.py", "**/*.js", "**/*.ts"],
                "exclude": ["**/test_*", "node_modules/"]
            },
            ast_rules=[
                AstRule(
                    id="hardcoded-secret-ast",
                    name="Hardcoded API Key (AST)",
                    description="Detects string literals that appear to be API keys or tokens",
                    severity="critical",
                    language="python",
                    pattern=AstNodePattern(
                        node_type="string",
                        value_regex="^(?=.*[A-Za-z])(?=.*\\d)[A-Za-z0-9+/=_-]{32,}$",
                        constraints={
                            "min_length": 32,
                            "exclude_regex": [
                                r"[A-Za-z0-9_-]+/[A-Za-z0-9_-]+",
                                r"\\b(groq|meta-llama|openai|anthropic|mistral)\\b",
                            ],
                        },
                    )
                ),
                AstRule(
                    id="dangerous-function-call",
                    name="Dangerous Function Call",
                    description="Detects calls to dangerous functions like eval()",
                    severity="critical",
                    language="python",
                    pattern=AstNodePattern(
                        node_type="call",
                        properties={"function_name": "eval"}
                    )
                ),
                AstRule(
                    id="sql-injection-ast",
                    name="Potential SQL Injection (AST)",
                    description="Detects string operations that might lead to SQL injection",
                    severity="critical",
                    language="python",
                    pattern=AstNodePattern(
                        node_type="binary_op",
                        properties={"operator": "+"},
                        children=[
                            AstNodePattern(
                                node_type="string",
                                value_regex="(?i)(select|insert|update|delete)"
                            )
                        ]
                    )
                ),
                AstRule(
                    id="too-many-params",
                    name="Function with Too Many Parameters",
                    description="Detects functions with more than 7 parameters",
                    severity="medium",
                    language="python",
                    pattern=AstNodePattern(
                        node_type="function_definition",
                        constraints={"args_count": {"min": 8}}
                    )
                )
            ]
        ),
        actions=[
            TaskAction(type="email-report", trigger="findings", recipients=["security@example.com"]),
            TaskAction(type="in-app-notify", trigger="findings")
        ]
    )

    config_loader.save_task(ast_security_scanner_task)
    print(f"Task '{ast_security_scanner_task.name}' added/updated as YAML config.")

if __name__ == "__main__":
    asyncio.run(add_ast_security_scanner_task())
