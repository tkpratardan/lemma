# Architecture

The system relies on two key perspectives: the component view, and the request-by-request workflow.

## Component view

```mermaid
graph TB
    Agent["Agent (external)"] <-->|"requests/responses"| MCP

    subgraph Lemma ["Lemma: the system"]
        direction TB

        MCP{"MCP Entry Point"}

        subgraph Tooling [" "]
            direction LR
            Shared_Utils[["Shared Utilities (library)<br/>diff() · render()<br/>pure functions"]]
            Output_Norm["Collect and Normalize Output<br/>reads raw output, assembles ONE<br/>final MCP tool-result (keeps it DRY)"]
        end
        style Tooling stroke-width:0px,fill:transparent

        subgraph Adapters ["Gateway Adapters"]
            direction LR
            subgraph Jupyter ["JupyterLab Adapter"]
                kernel_client["kernel_client"]
                nbmodel_client["nbmodel_client (RTC)"]
            end
            subgraph PyCharm ["PyCharm Adapter"]
                pycharm_disk["disk.ts (.ipynb read-modify-write)"]
                pycharm_kernel["kernel-http client<br/>(@jupyterlab/services, HTTP/WebSocket)"]
            end
            subgraph VSCode ["VS Code Adapter"]
                extension["extension<br/>(notebook.ts + bridge.ts)"]
            end
        end


        %% Library Dependencies
        Shared_Utils -.->|"imported by"| Output_Norm
        Shared_Utils -.->|"imported by"| Adapters

        %% Control Flow
        MCP -->|"route by surface"| Jupyter
        MCP -->|"route by surface"| PyCharm
        MCP -->|"route by surface"| VSCode



        %% Data Flow

        Output_Norm -->|"final response"| MCP

    end

    subgraph Execution_Env ["Execution Environments"]
            direction LR
            JServer[("Jupyter Server<br/>(local, remote, or Docker-forwarded)")]
            Disk[("On-disk .ipynb<br/>(PyCharm re-renders on change)")]
            VHost[("VS Code Notebook + Kernel")]
    end
    Jupyter <-->|"REST API / RTC websocket"| JServer
    PyCharm <-->|"kernel over HTTP/WS"| JServer
    PyCharm -->|"writes cells + outputs"| Disk
    VSCode <-->|"vscode.* extension API"| VHost

    Execution_Env -->|"raw cell/output<br/>(one path, any source)"| Output_Norm

    style Lemma stroke-dasharray: 5 5,fill:transparent,stroke:#777,stroke-width:2px
```

Every backend's raw output reaches `Output_Norm` by a single path. `Output_Norm` is the only place a final MCP tool response is assembled. No adapter duplicates diffing or rendering.

All three adapters are pure TypeScript. `PyCharm` has no IDE plugin because PyCharm exposes no public API to drive its notebook UI. It talks to any accessible Jupyter server over HTTP/WebSocket via a `kernel-http` client built on `@jupyterlab/services`. This is the same mechanism `Jupyter` uses minus the RTC/Yjs document sync, since there is no editor tab to keep live. It writes cells and outputs to the `.ipynb` on disk through `disk.ts`, and PyCharm reloads the notebook when the file changes. An earlier design ran this kernel-http client's execution through a separate Python process (`jupyter_client` over ZMQ) for the one case the HTTP path did not cover. That process was removed once the HTTP path made it redundant for every other case. A standalone, agent-facing "headless" surface built on this same client also existed and was later removed as not useful to the product.

`Shared_Utils` is a library of pure functions (`diff()`, `render()`) that `Output_Norm` calls into, not an active pipeline stage. The JupyterLab, PyCharm, and VS Code adapters each have their own externally-owned notebook structure (RTC document, on-disk `.ipynb`, `vscode.NotebookDocument`).

## Directory structure

- `src/mcp/`: The Model Context Protocol entry point. It contains `server.ts` to register tools and route requests.
- `src/adapters/`: The pure TypeScript gateway adapters (`jupyterlab/`, `pycharm/`, `vscode/`, `kernel-http/`) that translate MCP requests into execution environment protocols.
- `src/utils/`: Shared logic. It includes pure functions like `diff.ts` and `render.ts` to collect and normalize output from adapters.
- `extensions/`: Editor extensions. It includes the VS Code extension code (`extensions/vscode/`) that bridges Lemma's adapter to the VS Code API.
- `scripts/`: Development and build tools, such as scripts to synchronize rules across agent configuration folders.
- `bin/`: Executable scripts like `install.js` used to install and set up the system.
- `skills/`: The specific agent skills that execute tasks rigorously. The rigor is enforced by the prompt instructions and the agent's persona.

## Workflow (one request, start to finish)

```mermaid
sequenceDiagram
    actor Human
    participant Agent
    participant Hooks as Persona/Hooks
    participant Bash
    participant Core as Lemma Core (TS)
    participant Adapter
    participant Backend as Kernel / Server / Editor

    Human->>Agent: states intent ("build a model on this CSV")
    Agent->>Hooks: SessionStart fires
    Hooks->>Hooks: another persona already active?
    alt persona already active
        Hooks-->>Agent: inject short complement note
    else nothing active
        Hooks-->>Agent: inject persona (repo's own rules first, lemma as a lens on top)
    end

    Agent->>Bash: find or start a server (not lemma's job)
    Bash-->>Agent: address (url + token + path)

    Agent->>Core: call lemma tool (e.g. notebook_add_and_run) with address
    Hooks-->>Agent: UserPromptSubmit reinforcement (mode-gated)

    Core->>Adapter: route to the matching adapter
    Adapter->>Backend: protocol call (HTTP/WS / REST+RTC / vscode.*)
    Backend-->>Adapter: raw cell/output data
    Adapter-->>Core: raw Cell/Output (shared shape)

    Core->>Core: shared diff + render/normalize

    Core-->>Agent: result + diff
    Agent->>Human: relay result, apply the method

    loop session continues
        Human->>Agent: next instruction
    end

    Note over Core,Hooks: An offline eval harness periodically measures whether<br/>the persona changes behaviour (rigor-adherence), separate from any live request
```

## Reading the two diagrams together

The component diagram shows the system boundary of lemma. Persona, skills, hooks, and kernel discovery are real but not the core code of lemma. They collapse to a single external `Agent` box and are decomposed in the workflow diagram. `Shared_Utils` and `Output_Norm` are the only place business logic lives. All three adapters are intentionally thin protocol plumbing. Lemma ships no live code-checking layer. Rigor lives in the persona and skills, and the eval harness is offline dev tooling that never runs as part of a live request, appearing only as a note in the workflow.
