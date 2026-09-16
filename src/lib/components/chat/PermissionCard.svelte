<script lang="ts">
  import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
  import type { ChatSession, PermissionItem } from "$lib/chat/session.svelte";
  import { describeTool } from "$lib/chat/tools";
  import { BLENDER_TOOLS } from "../../../../agent/protocol";
  import Markdown from "./Markdown.svelte";
  import ToolInput from "./ToolInput.svelte";

  interface Question {
    question: string;
    header: string;
    options: { label: string; description: string }[];
    multiSelect: boolean;
  }

  let { item, session }: { item: PermissionItem; session: ChatSession } = $props();

  const request = $derived(item.request);
  const pending = $derived(item.state === "pending");
  const description = $derived(describeTool(request.toolName, request.input, session.folder));
  const isEdit = $derived(
    request.toolName === BLENDER_TOOLS.run || ["Edit", "Write", "NotebookEdit"].includes(request.toolName),
  );
  const canAlwaysAllow = $derived(!request.suppressAlwaysAllow && Boolean(request.suggestions?.length));
  const plan = $derived(typeof request.input.plan === "string" ? request.input.plan : null);
  const questions = $derived(
    request.toolName === "AskUserQuestion" && Array.isArray(request.input.questions)
      ? (request.input.questions as Question[])
      : [],
  );

  let selections = $state<Record<number, string[]>>({});
  let others = $state<Record<number, string>>({});

  const stateLabels = { allowed: "Permitido", denied: "Denegado", cancelled: "Cancelado", pending: "" };

  function allow(answer = "Permitido") {
    session.respond(item, { behavior: "allow", updatedInput: request.input }, answer);
  }

  function allowAlways() {
    const result = { behavior: "allow" as const, updatedInput: request.input, updatedPermissions: request.suggestions };
    session.respond(item, result, "Permitido durante esta sesión");
  }

  function allowEdits() {
    allow("Permitido; las siguientes ediciones se aceptan automáticamente");
    session.setMode("acceptEdits");
  }

  function deny() {
    // Like Claude Code, a denial ends the turn so the user can say what to do instead.
    session.respond(item, { behavior: "deny", message: "The user denied this action.", interrupt: true }, "Denegado");
  }

  function approvePlan(mode: PermissionMode, answer: string) {
    session.respond(
      item,
      {
        behavior: "allow",
        updatedInput: request.input,
        updatedPermissions: [{ type: "setMode", mode, destination: "session" }],
      },
      answer,
    );
    session.setMode(mode);
  }

  function keepPlanning() {
    session.respond(
      item,
      { behavior: "deny", message: "The user wants to keep planning and will give feedback.", interrupt: true },
      "Seguir planificando",
    );
  }

  function toggleOption(index: number, label: string, multiSelect: boolean) {
    const current = selections[index] ?? [];
    if (multiSelect) {
      selections[index] = current.includes(label) ? current.filter((value) => value !== label) : [...current, label];
    } else {
      selections[index] = current[0] === label ? [] : [label];
      others[index] = "";
    }
  }

  function answerFor(index: number, question: Question): string {
    const other = others[index]?.trim();
    const selected = selections[index] ?? [];
    if (!question.multiSelect) return other || selected[0] || "";
    return [...selected, ...(other ? [other] : [])].join(", ");
  }

  const answered = $derived(questions.every((question, index) => answerFor(index, question)));

  function submitAnswers() {
    const answers = Object.fromEntries(questions.map((question, index) => [question.question, answerFor(index, question)]));
    session.respond(
      item,
      { behavior: "allow", updatedInput: { ...request.input, answers } },
      Object.values(answers).join(" · "),
    );
  }

  function skipQuestions() {
    session.respond(
      item,
      { behavior: "deny", message: "The user skipped the question; continue with your best judgment." },
      "Sin responder",
    );
  }
</script>

<div class="card" class:resolved={!pending}>
  {#if request.toolName === "ExitPlanMode"}
    <div class="title">Plan propuesto</div>
    {#if plan}
      <div class="plan"><Markdown text={plan} /></div>
    {/if}
    {#if pending}
      <p class="prompt">¿Quieres que Claude ejecute este plan?</p>
      <div class="buttons column">
        <button class="primary" onclick={() => approvePlan("acceptEdits", "Plan aprobado; ediciones automáticas")}>
          Sí, y aceptar las ediciones automáticamente
        </button>
        <button class="secondary" onclick={() => approvePlan("default", "Plan aprobado; se pedirá permiso")}>
          Sí, pero pedir permiso para cada cambio
        </button>
        <button class="secondary" onclick={keepPlanning}>No, seguir planificando</button>
      </div>
    {/if}
  {:else if questions.length}
    {#each questions as question, index (index)}
      <div class="question">
        <span class="chip">{question.header}</span>
        <p class="prompt">{question.question}</p>
        <div class="options">
          {#each question.options as option (option.label)}
            <button
              class="option"
              class:selected={selections[index]?.includes(option.label)}
              disabled={!pending}
              onclick={() => toggleOption(index, option.label, question.multiSelect)}
            >
              <span class="option-label">{option.label}</span>
              <span class="option-description">{option.description}</span>
            </button>
          {/each}
          {#if pending}
            <input
              class="other"
              placeholder="Otra respuesta…"
              aria-label="Otra respuesta"
              bind:value={
                () => others[index] ?? "",
                (value) => {
                  others[index] = value;
                  if (value.trim() && !question.multiSelect) selections[index] = [];
                }
              }
            />
          {/if}
        </div>
      </div>
    {/each}
    {#if pending}
      <div class="buttons">
        <button class="primary" disabled={!answered} onclick={submitAnswers}>Responder</button>
        <button class="secondary" onclick={skipQuestions}>Omitir</button>
      </div>
    {/if}
  {:else}
    <div class="title">
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 1.5 13.5 3.5v4c0 3.3-2.3 6-5.5 7-3.2-1-5.5-3.7-5.5-7v-4z" />
      </svg>
      ¿Permitir «{description.label}»?
    </div>
    {#if description.detail && request.toolName !== "Bash"}
      <div class="detail">{description.detail}</div>
    {/if}
    <ToolInput name={request.toolName} input={request.input} />
    {#if request.blockedPath}
      <p class="note">Accede a una ruta fuera de la carpeta: {request.blockedPath}</p>
    {/if}
    {#if pending}
      <div class="buttons">
        <button class="primary" onclick={() => allow()}>Permitir</button>
        {#if isEdit && session.mode !== "acceptEdits"}
          <button class="secondary" onclick={allowEdits}>Permitir y aceptar ediciones</button>
        {:else if canAlwaysAllow}
          <button class="secondary" onclick={allowAlways}>Permitir siempre en esta sesión</button>
        {/if}
        <button class="secondary" onclick={deny}>Denegar</button>
      </div>
    {/if}
  {/if}

  {#if !pending}
    <div class="answer {item.state}">{item.answer ?? stateLabels[item.state]}</div>
  {/if}
</div>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 6px 0;
    padding: 10px 12px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--bg-widget);
  }

  .card.resolved {
    border-color: var(--border-strong);
  }

  .title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--text-bright);
  }

  .title svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--accent-text);
    stroke-width: 1.3;
  }

  .detail {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .plan {
    max-height: 360px;
    overflow: auto;
    padding: 8px 10px;
    border-radius: 4px;
    background: var(--bg-editor);
  }

  .prompt {
    margin: 0;
    color: var(--text-bright);
  }

  .note {
    margin: 0;
    font-size: 12px;
    color: var(--warning);
  }

  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .buttons.column {
    flex-direction: column;
    align-items: stretch;
  }

  .primary,
  .secondary {
    padding: 4px 12px;
    border-radius: 3px;
    text-align: center;
  }

  .primary {
    background: var(--accent);
    color: #fff;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .secondary {
    background: var(--bg-button-secondary);
    color: var(--text);
  }

  .secondary:hover {
    background: var(--bg-button-secondary-hover);
  }

  button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .question {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .chip {
    align-self: flex-start;
    padding: 0 6px;
    border-radius: 3px;
    background: var(--bg-button-secondary);
    font-size: 11px;
    color: var(--text-muted);
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .option {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    text-align: left;
  }

  .option:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .option.selected {
    border-color: var(--accent);
    background: rgba(0, 120, 212, 0.15);
  }

  .option:disabled:not(.selected) {
    opacity: 0.5;
  }

  .option-label {
    color: var(--text-bright);
  }

  .option-description {
    font-size: 12px;
    color: var(--text-muted);
  }

  .other {
    padding: 5px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    background: var(--bg-input);
    color: var(--text);
    font: inherit;
  }

  .other:focus {
    outline: 1px solid var(--accent);
    border-color: var(--accent);
  }

  .answer {
    font-size: 12px;
    color: var(--text-muted);
  }

  .answer.allowed {
    color: var(--success);
  }

  .answer.denied {
    color: var(--error);
  }
</style>
