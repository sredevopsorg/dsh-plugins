window.__ModuleLoader__.load({
  id: '@sredevopsorg/dsh-subagent-opencode',
  factory(require) {
    const React = require('react');
    const { useEffect, useMemo, useRef, useState } = React;
    const h = React.createElement;

    const PKG = '@sredevopsorg/dsh-subagent-opencode';
    const ROW_ID = 'subagent-opencode';
    const NS = 'subagentOpencodeSettings';
    const ROUTE = '__dsh-subagent-opencode-settings';
    const BUNDLE_KEY = PKG;
    const ROW_KEY = `${PKG}#${ROW_ID}`;
    const PREFIX = 'dsh-soc';

    const EN = {
      'section.title': 'Provider settings',
      'section.intro': 'These values configure how the OpenCode CLI is started for a one-shot delegation. Changes apply to later delegations.',
      'provider.title': 'Provider',
      'requirements.title': 'Required configuration',
      'install.title': 'Install when missing',
      'field.providerName': 'Provider name',
      'help.providerName': 'The delegation tool points at opencode; change that row too when you rename the provider.',
      'field.command': 'OpenCode command',
      'help.command': 'A bare executable resolved on PATH, or an absolute path.',
      'field.args': 'Arguments',
      'help.args': 'One argument per line. acp is added when it is absent.',
      'field.permission': 'Permission policy',
      'help.permission': 'How the child answers its own permission prompts. A never session still refuses when `session` is selected.',
      'permission.session': 'Follow the delegating session',
      'permission.reject': 'Reject every prompt',
      'permission.allow': 'Allow every prompt',
      'field.passEnv': 'Relayed environment names',
      'help.passEnv': 'One name per line. Only variables present in the DSH process are forwarded.',
      'field.disposeGraceMs': 'Shutdown grace (ms)',
      'help.disposeGraceMs': 'How long the child may run after its input closes before it is terminated.',
      'field.require': 'Required gates',
      'help.require': 'A missing gate fails the plugin load, so a broken profile fails at startup instead of on first delegation.',
      'gate.install': 'Install',
      'gate.credentials': 'Credentials',
      'gate.auth': 'Stored login',
      'gate.model': 'Model',
      'field.credentials': 'Credential variable names',
      'help.credentials': 'One environment variable name per line. Names only; values are never shown here.',
      'field.model': 'Model',
      'help.model': 'Provider/model applied to every session, for example openai/gpt-5-codex.',
      'field.mode': 'Agent mode',
      'help.mode': 'OpenCode agent id applied to every session.',
      'field.effort': 'Effort',
      'help.effort': 'Model variant applied to every session.',
      'field.home': 'OpenCode home',
      'help.home': 'Exported as OPENCODE_HOME and used by the stored-login gate.',
      'field.install': 'Install OpenCode when the command does not resolve',
      'help.install': 'Off by default: a delegation never downloads a program unless this is on.',
      'field.installManager': 'Package manager',
      'help.installManager': 'The manager used for the explicit install. none refuses to install.',
      'manager.pnpm': 'pnpm',
      'manager.npm': 'npm',
      'manager.none': 'None',
      'field.installDir': 'Install directory',
      'help.installDir': 'Absolute directory the install writes to and is reused from.',
      'field.installArgs': 'Extra install arguments',
      'help.installArgs': 'One argument per line, before the packages.',
      'field.installTimeoutMs': 'Install timeout (ms)',
      'help.installTimeoutMs': 'Bound on one explicit install run.',
      'advanced': 'Advanced',
      'onePerLine': 'One per line.',
      'action.save': 'Save',
      'action.saving': 'Saving…',
      'action.reset': 'Reset to defaults',
      'action.discard': 'Discard changes',
      'action.resetting': 'Resetting…',
      'notice.reset': 'Defaults restored.',
      'notice.resetStale': 'These settings changed elsewhere. The defaults were not reset; review the latest values and try Reset again.',
      'notice.stale': 'These settings changed elsewhere. Reload the latest values or overwrite them with your changes.',
      'conflict.title': 'Settings changed elsewhere',
      'conflict.intro': 'Someone else changed these settings after this page read them.',
      'conflict.reload': 'Reload latest',
      'conflict.overwrite': 'Overwrite with my changes',
      'error.load': 'Could not load settings. {message}',
      'error.endpoint': 'The settings endpoint is not available. Make sure this plugin row is enabled, then reload the page.',
      'error.length': 'Use at most {max} characters.',
      'error.entries': 'Use at most 256 entries, each at most 4096 characters.',
      'state.overridden': 'A higher configuration layer overrides this row. Edit that layer instead.',
      'state.unavailable': 'Settings cannot be changed in this profile.',
      'advanced.provider': 'Advanced provider options',
      'advanced.requirements': 'Advanced requirement options',
      'advanced.install': 'Advanced install options',
      'action.confirmReset': 'Reset the settings on this page to the bundle defaults?',
      'action.confirm': 'Reset',
      'action.cancel': 'Cancel',
      'state.loading': 'Loading settings…',
      'state.retry': 'Retry',
      'state.readonly': 'Read-only',
      'state.inactive': 'The provider row is not active, so its settings cannot be changed right now.',
      'state.expression': 'This row uses a YAML expression. Edit it in cordis.patch.yml instead.',
      'notice.saved': 'Settings saved. Later delegations use the new values.',
      'notice.failed': 'The settings were not saved. {message}',
      'error.required': 'Enter a value.',
      'error.number': 'Enter a whole number.',
      'error.range': 'Enter a value from {min} to {max}.',
      'error.model': 'Use provider/model.',
      'error.absolute': 'Enter an absolute path.',
      'error.auth': 'The browser session expired. Reload the page to continue.',
      'error.forbidden': 'This browser is not authorized to change plugin settings.',
      'error.unavailable': 'Settings cannot be changed in this profile.',
      'error.overridden': 'A higher configuration layer overrides this row. Edit that layer instead.',
      'error.entryMissing': 'The provider row is not active. Reopen the page after enabling it.',
      'error.tooLarge': 'The request was too large.',
      'summary': 'Provider, permission, and OpenCode requirement settings.',
    };

    const ES = {
      'section.title': 'Ajustes del proveedor',
      'section.intro': 'Estos valores configuran cómo se inicia la CLI de OpenCode para una delegación de una sola vez. Los cambios se aplican a las delegaciones posteriores.',
      'provider.title': 'Proveedor',
      'requirements.title': 'Configuración requerida',
      'install.title': 'Instalar si falta',
      'field.providerName': 'Nombre del proveedor',
      'help.providerName': 'La herramienta de delegación apunta a opencode; cambia esa fila también si renombras el proveedor.',
      'field.command': 'Comando de OpenCode',
      'help.command': 'Un ejecutable sin ruta que se busca en PATH, o una ruta absoluta.',
      'field.args': 'Argumentos',
      'help.args': 'Un argumento por línea. acp se agrega cuando falta.',
      'field.permission': 'Política de permisos',
      'help.permission': 'Cómo responde el hijo a sus propios pedidos de permiso. Una sesión never igual rechaza cuando se elige `session`.',
      'permission.session': 'Seguir la sesión que delega',
      'permission.reject': 'Rechazar todos los pedidos',
      'permission.allow': 'Permitir todos los pedidos',
      'field.passEnv': 'Nombres de entorno retransmitidos',
      'help.passEnv': 'Un nombre por línea. Solo se reenvían las variables presentes en el proceso de DSH.',
      'field.disposeGraceMs': 'Gracia de cierre (ms)',
      'help.disposeGraceMs': 'Cuánto puede seguir el hijo después de cerrar su entrada antes de terminarlo.',
      'field.require': 'Puertas requeridas',
      'help.require': 'Una puerta faltante hace fallar la carga del plugin, así un perfil roto falla al iniciar en vez de en la primera delegación.',
      'gate.install': 'Instalación',
      'gate.credentials': 'Credenciales',
      'gate.auth': 'Login guardado',
      'gate.model': 'Modelo',
      'field.credentials': 'Nombres de variables de credenciales',
      'help.credentials': 'Un nombre de variable de entorno por línea. Solo nombres; los valores nunca se muestran aquí.',
      'field.model': 'Modelo',
      'help.model': 'Proveedor/modelo aplicado a cada sesión, por ejemplo openai/gpt-5-codex.',
      'field.mode': 'Modo del agente',
      'help.mode': 'Id de agente de OpenCode aplicado a cada sesión.',
      'field.effort': 'Esfuerzo',
      'help.effort': 'Variante del modelo aplicada a cada sesión.',
      'field.home': 'Home de OpenCode',
      'help.home': 'Se exporta como OPENCODE_HOME y lo usa la puerta de login guardado.',
      'field.install': 'Instalar OpenCode cuando el comando no se resuelve',
      'help.install': 'Apagado por defecto: una delegación nunca descarga un programa salvo que esto esté activo.',
      'field.installManager': 'Gestor de paquetes',
      'help.installManager': 'El gestor que usa la instalación explícita. none se niega a instalar.',
      'manager.pnpm': 'pnpm',
      'manager.npm': 'npm',
      'manager.none': 'Ninguno',
      'field.installDir': 'Directorio de instalación',
      'help.installDir': 'Directorio absoluto donde escribe la instalación y del que se reutiliza.',
      'field.installArgs': 'Argumentos extra de instalación',
      'help.installArgs': 'Un argumento por línea, antes de los paquetes.',
      'field.installTimeoutMs': 'Tiempo límite de instalación (ms)',
      'help.installTimeoutMs': 'Límite para una ejecución de instalación explícita.',
      'advanced': 'Avanzado',
      'onePerLine': 'Uno por línea.',
      'action.save': 'Guardar',
      'action.saving': 'Guardando…',
      'action.reset': 'Restablecer valores',
      'action.discard': 'Descartar cambios',
      'action.resetting': 'Restableciendo…',
      'notice.reset': 'Valores predeterminados restablecidos.',
      'notice.resetStale': 'Los ajustes cambiaron en otro lugar. No se restablecieron los valores; revisa los valores actuales e intenta Restablecer de nuevo.',
      'notice.stale': 'Los ajustes cambiaron en otro lugar. Recarga los valores actuales o sobrescríbelos con tus cambios.',
      'conflict.title': 'Los ajustes cambiaron en otro lugar',
      'conflict.intro': 'Otra persona cambió estos ajustes después de que esta página los leyera.',
      'conflict.reload': 'Recargar valores actuales',
      'conflict.overwrite': 'Sobrescribir con mis cambios',
      'error.load': 'No se pudieron cargar los ajustes. {message}',
      'error.endpoint': 'El endpoint de ajustes no está disponible. Asegúrate de que esta fila del plugin esté activa y recarga la página.',
      'error.length': 'Usa como máximo {max} caracteres.',
      'error.entries': 'Usa como máximo 256 entradas, cada una de hasta 4096 caracteres.',
      'state.overridden': 'Una capa de configuración superior reemplaza esta fila. Edita esa capa.',
      'state.unavailable': 'Los ajustes no se pueden cambiar en este perfil.',
      'advanced.provider': 'Opciones avanzadas del proveedor',
      'advanced.requirements': 'Opciones avanzadas de requisitos',
      'advanced.install': 'Opciones avanzadas de instalación',
      'action.confirmReset': '¿Restablecer los ajustes de esta página a los valores del bundle?',
      'action.confirm': 'Restablecer',
      'action.cancel': 'Cancelar',
      'state.loading': 'Cargando ajustes…',
      'state.retry': 'Reintentar',
      'state.readonly': 'Solo lectura',
      'state.inactive': 'La fila del proveedor no está activa, así que sus ajustes no se pueden cambiar ahora.',
      'state.expression': 'Esta fila usa una expresión YAML. Edítala en cordis.patch.yml.',
      'notice.saved': 'Ajustes guardados. Las próximas delegaciones usan los nuevos valores.',
      'notice.failed': 'Los ajustes no se guardaron. {message}',
      'error.required': 'Escribe un valor.',
      'error.number': 'Escribe un número entero.',
      'error.range': 'Escribe un valor entre {min} y {max}.',
      'error.model': 'Usa proveedor/modelo.',
      'error.absolute': 'Escribe una ruta absoluta.',
      'error.auth': 'La sesión del navegador expiró. Recarga la página para continuar.',
      'error.forbidden': 'Este navegador no está autorizado a cambiar los ajustes del plugin.',
      'error.unavailable': 'Los ajustes no se pueden cambiar en este perfil.',
      'error.overridden': 'Una capa de configuración superior reemplaza esta fila. Edita esa capa.',
      'error.entryMissing': 'La fila del proveedor no está activa. Vuelve a abrir la página después de activarla.',
      'error.tooLarge': 'La solicitud era demasiado grande.',
      'summary': 'Ajustes de proveedor, permisos y requisitos de OpenCode.',
    };

    const PROVIDER_FIELDS = [
      { path: 'providerName', kind: 'text', required: true, advanced: true, maxLength: 1024, labelKey: 'field.providerName', helpKey: 'help.providerName' },
      { path: 'command', kind: 'text', required: true, maxLength: 1024, labelKey: 'field.command', helpKey: 'help.command' },
      { path: 'args', kind: 'lines', rows: 2, labelKey: 'field.args', helpKey: 'help.args' },
      { path: 'permission', kind: 'select', labelKey: 'field.permission', helpKey: 'help.permission', options: [
        { value: 'session', labelKey: 'permission.session' },
        { value: 'reject', labelKey: 'permission.reject' },
        { value: 'allow', labelKey: 'permission.allow' },
      ] },
      { path: 'passEnv', kind: 'lines', rows: 3, labelKey: 'field.passEnv', helpKey: 'help.passEnv' },
      { path: 'disposeGraceMs', kind: 'number', min: 1, max: 2147483647, labelKey: 'field.disposeGraceMs', helpKey: 'help.disposeGraceMs' },
    ];

    const REQUIREMENT_FIELDS = [
      { path: 'requirements.require', kind: 'gates', labelKey: 'field.require', helpKey: 'help.require', options: [
        { value: 'install', labelKey: 'gate.install' },
        { value: 'credentials', labelKey: 'gate.credentials' },
        { value: 'auth', labelKey: 'gate.auth' },
        { value: 'model', labelKey: 'gate.model' },
      ] },
      { path: 'requirements.credentials', kind: 'lines', rows: 2, labelKey: 'field.credentials', helpKey: 'help.credentials' },
      { path: 'requirements.model', kind: 'text', optional: true, pattern: 'model', maxLength: 4096, labelKey: 'field.model', helpKey: 'help.model' },
      { path: 'requirements.mode', kind: 'text', optional: true, advanced: true, maxLength: 4096, labelKey: 'field.mode', helpKey: 'help.mode' },
      { path: 'requirements.effort', kind: 'text', optional: true, advanced: true, maxLength: 4096, labelKey: 'field.effort', helpKey: 'help.effort' },
      { path: 'requirements.home', kind: 'text', optional: true, advanced: true, maxLength: 4096, labelKey: 'field.home', helpKey: 'help.home' },
    ];

    const INSTALL_FIELDS = [
      { path: 'requirements.install', kind: 'switch', labelKey: 'field.install', helpKey: 'help.install' },
      { path: 'requirements.installManager', kind: 'select', labelKey: 'field.installManager', helpKey: 'help.installManager', options: [
        { value: 'pnpm', labelKey: 'manager.pnpm' },
        { value: 'npm', labelKey: 'manager.npm' },
        { value: 'none', labelKey: 'manager.none' },
      ] },
      { path: 'requirements.installDir', kind: 'text', optional: true, advanced: true, maxLength: 4096, pattern: 'absolute', labelKey: 'field.installDir', helpKey: 'help.installDir' },
      { path: 'requirements.installArgs', kind: 'lines', rows: 2, advanced: true, labelKey: 'field.installArgs', helpKey: 'help.installArgs' },
      { path: 'requirements.installTimeoutMs', kind: 'number', min: 1, max: 2147483647, advanced: true, labelKey: 'field.installTimeoutMs', helpKey: 'help.installTimeoutMs' },
    ];

    const SECTIONS = [
      { titleKey: 'provider.title', advancedLabelKey: 'advanced.provider', fields: PROVIDER_FIELDS },
      { titleKey: 'requirements.title', advancedLabelKey: 'advanced.requirements', fields: REQUIREMENT_FIELDS },
      { titleKey: 'install.title', advancedLabelKey: 'advanced.install', fields: INSTALL_FIELDS },
    ];

    const FIELDS = SECTIONS.flatMap(section => section.fields);

    const CSS = `
.dsh-soc {
  box-sizing: border-box;
  width: 100%;
  max-width: 620px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  color: var(--dsw-alias-label-primary);
  font-family: var(--dsw-font-family);
  font-size: 13px;
  line-height: 20px;
}
.dsh-soc *, .dsh-soc *::before, .dsh-soc *::after { box-sizing: border-box; }
.dsh-soc__head { display: flex; flex-direction: column; gap: 4px; }
.dsh-soc__title { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
.dsh-soc__intro { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.dsh-soc__section { display: flex; flex-direction: column; gap: 12px; }
.dsh-soc__section + .dsh-soc__section { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 14px; }
.dsh-soc__fields { display: flex; flex-direction: column; gap: 12px; }
.dsh-soc__field { display: flex; flex-direction: column; gap: 4px; }
.dsh-soc__label { font-weight: 500; font-size: 12px; line-height: 18px; }
.dsh-soc__help { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.dsh-soc__error { color: var(--dsw-alias-state-error-primary); font-size: 11px; line-height: 16px; }
.dsh-soc__input, .dsh-soc__select, .dsh-soc__textarea {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  outline: none;
}
.dsh-soc__textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; min-height: 44px; }
.dsh-soc__input:focus, .dsh-soc__select:focus, .dsh-soc__textarea:focus {
  border-color: var(--dsw-alias-brand-primary);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-focus-ring-color) 45%, transparent);
}
.dsh-soc__input[aria-invalid='true'], .dsh-soc__select[aria-invalid='true'], .dsh-soc__textarea[aria-invalid='true'] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-soc__input:disabled, .dsh-soc__select:disabled, .dsh-soc__textarea:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  background: var(--dsw-alias-bg-layer-2);
}
.dsh-soc__required { color: var(--dsw-alias-state-error-primary); }
.dsh-soc__conflict {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l1));
  border-radius: 6px;
  font-size: 12px;
  color: var(--dsw-alias-label-secondary);
}
.dsh-soc__switch-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.dsh-soc__switch-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dsh-soc__switch {
  position: relative;
  flex: none;
  width: 34px;
  height: 20px;
  margin-top: 1px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
}
.dsh-soc__switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); }
.dsh-soc__switch:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.dsh-soc__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}
.dsh-soc__switch[aria-checked='true'] .dsh-soc__knob { transform: translateX(14px); background: var(--dsw-alias-bg-base); }
.dsh-soc__switch:disabled { opacity: 0.55; cursor: not-allowed; }
.dsh-soc__gates { display: flex; flex-wrap: wrap; gap: 10px 18px; padding: 0; margin: 0; border: 0; }
.dsh-soc__gate { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.dsh-soc__gate input { margin: 0; accent-color: var(--dsw-alias-brand-primary); }
.dsh-soc__advanced { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; }
.dsh-soc__advanced > summary { cursor: pointer; font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dsh-soc__advanced[open] > summary { margin-bottom: 12px; }
.dsh-soc__notice { border-radius: 6px; padding: 6px 9px; font-size: 12px; line-height: 18px; }
.dsh-soc__notice[data-tone='success'] { color: var(--dsw-alias-state-success-primary); background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); }
.dsh-soc__notice[data-tone='error'] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.dsh-soc__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.dsh-soc__button {
  appearance: none;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  padding: 5px 12px;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dsh-soc__button:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2); }
.dsh-soc__button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 2px; }
.dsh-soc__button:disabled { opacity: 0.55; cursor: default; }
.dsh-soc__button--primary { background: var(--dsw-alias-brand-primary); border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsh-soc__button--primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.05); }
.dsh-soc__button--danger { color: var(--dsw-alias-state-error-primary); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l1)); }
.dsh-soc__confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dsh-soc__muted { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dsh-soc__state { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
`;

    function isAbsolutePath(text) {
      return text !== '/' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(text);
    }

    function getPath(value, path) {
      let current = value;
      for (const key of path.split('.')) {
        if (current === null || typeof current !== 'object') return undefined;
        current = current[key];
      }
      return current;
    }

    function setPath(target, path, value) {
      const parts = path.split('.');
      let current = target;
      for (const part of parts.slice(0, -1)) {
        if (current[part] === null || typeof current[part] !== 'object' || Array.isArray(current[part])) {
          current[part] = {};
        }
        current = current[part];
      }
      current[parts[parts.length - 1]] = value;
    }

    function valuesToDraft(values, fields) {
      const draft = {};
      for (const field of fields) {
        const value = getPath(values, field.path);
        switch (field.kind) {
          case 'lines':
            draft[field.path] = Array.isArray(value) ? value.join('\n') : '';
            break;
          case 'number':
            draft[field.path] = value === undefined || value === null ? '' : String(value);
            break;
          case 'switch':
            draft[field.path] = value === true;
            break;
          case 'gates':
            draft[field.path] = Array.isArray(value) ? [...value] : [];
            break;
          default:
            draft[field.path] = typeof value === 'string' ? value : '';
        }
      }
      return draft;
    }

    function draftToValues(draft, fields) {
      const values = {};
      for (const field of fields) {
        const raw = draft[field.path];
        switch (field.kind) {
          case 'lines':
            setPath(values, field.path, String(raw ?? '').split('\n').map(line => line.trim()).filter(line => line !== ''));
            break;
          case 'number':
            setPath(values, field.path, Number(String(raw ?? '').trim()));
            break;
          case 'switch':
            setPath(values, field.path, raw === true);
            break;
          case 'gates':
            setPath(values, field.path, Array.isArray(raw) ? [...raw] : []);
            break;
          default: {
            const text = String(raw ?? '');
            setPath(values, field.path, text.trim() === '' && field.optional === true ? null : text);
          }
        }
      }
      return values;
    }

    function validateDraft(draft, fields) {
      const errors = {};
      for (const field of fields) {
        if (field.kind === 'switch' || field.kind === 'gates') continue;
        const raw = draft[field.path];
        if (field.kind === 'lines') {
          const entries = String(raw ?? '').split('\n').map(line => line.trim()).filter(line => line !== '');
          if (entries.length > 256) errors[field.path] = 'entries';
          else if (entries.some(entry => entry.length > 4096)) errors[field.path] = 'length';
          continue;
        }
        if (field.kind === 'number') {
          const text = String(raw ?? '').trim();
          if (text === '') {
            errors[field.path] = 'required';
            continue;
          }
          const value = Number(text);
          if (!Number.isInteger(value)) errors[field.path] = 'number';
          else if ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max)) errors[field.path] = 'range';
          continue;
        }
        const text = String(raw ?? '');
        if (text.trim() === '') {
          if (field.optional !== true) errors[field.path] = 'required';
          continue;
        }
        if (field.maxLength !== undefined && text.length > field.maxLength) errors[field.path] = 'length';
        if (field.pattern === 'model' && !/^[^\s/\\]+\/[^\s/\\]+$/.test(text.trim())) errors[field.path] = 'model';
        if (field.pattern === 'absolute' && !isAbsolutePath(text.trim())) errors[field.path] = 'absolute';
      }
      return errors;
    }

    function fieldErrorText(field, code, t) {
      if (code === undefined) return '';
      if (code === 'range') return t('error.range', { min: field.min, max: field.max });
      if (code === 'length') return t('error.length', { max: field.maxLength ?? 4096 });
      return t(`error.${code}`);
    }

    function readOnlyText(reason, t) {
      if (reason === 'expression') return t('state.expression');
      if (reason === 'overridden') return t('state.overridden');
      if (reason === 'unavailable') return t('state.unavailable');
      return t('state.inactive');
    }

    function terminalReason(code) {
      if (code === 'expression') return 'expression';
      if (code === 'overridden') return 'overridden';
      if (code === 'entry-missing' || code === 'inactive') return 'inactive';
      if (code === 'editor-missing') return 'unavailable';
      return undefined;
    }

    function loadFailureText(status, body, t) {
      if (status === 401) return t('error.auth');
      if (status === 403) return t('error.forbidden');
      if (status === 404 || body?.code === 'not-found') return t('error.endpoint');
      if (status === 503 || body?.code === 'editor-missing') return t('error.unavailable');
      return t('error.load', { message: body?.message ?? '' });
    }

    function endpointUrl(suffix) {
      const base = new URL('.', document.baseURI || window.location.href);
      return new URL(`${ROUTE}/${suffix}`, base);
    }

    async function requestJson(url, init) {
      const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...init });
      let body;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { response, body };
    }

    function failureText(status, body, t) {
      const code = body === null || body === undefined ? undefined : body.code;
      if (status === 401) return t('error.auth');
      if (status === 403) return t('error.forbidden');
      if (status === 503 || code === 'editor-missing') return t('error.unavailable');
      if (code === 'inactive') return t('state.inactive');
      if (code === 'expression') return t('state.expression');
      if (code === 'overridden') return t('error.overridden');
      if (code === 'entry-missing') return t('error.entryMissing');
      if (status === 413) return t('error.tooLarge');
      return t('notice.failed', { message: body?.message ?? '' });
    }

    function createIds(field) {
      const key = field.path.replace(/\./g, '-');
      return { input: `dsh-soc-${key}`, help: `dsh-soc-${key}-help`, error: `dsh-soc-${key}-error` };
    }

    function requiredField(field) {
      return field.required === true || field.kind === 'number' || field.kind === 'select';
    }

    function RequiredMark({ field }) {
      return requiredField(field) ? h('span', { className: 'dsh-soc__required', 'aria-hidden': 'true' }, ' *') : null;
    }

    function TextField({ field, value, error, disabled, onChange, t }) {
      const ids = useMemo(() => createIds(field), [field]);
      const describedBy = [field.helpKey === undefined ? undefined : ids.help, error === undefined ? undefined : ids.error].filter(Boolean).join(' ');
      return h('div', { className: 'dsh-soc__field' },
        h('label', { className: 'dsh-soc__label', htmlFor: ids.input }, t(field.labelKey), h(RequiredMark, { field })),
        h('input', {
          id: ids.input,
          className: 'dsh-soc__input',
          type: field.kind === 'number' ? 'number' : 'text',
          inputMode: field.kind === 'number' ? 'numeric' : undefined,
          min: field.min,
          max: field.max,
          maxLength: field.maxLength,
          value,
          disabled,
          required: requiredField(field) || undefined,
          'aria-required': requiredField(field) ? 'true' : undefined,
          'aria-invalid': error === undefined ? undefined : 'true',
          'aria-describedby': describedBy === '' ? undefined : describedBy,
          onChange: event => onChange(event.target.value),
        }),
        field.helpKey === undefined ? null : h('span', { className: 'dsh-soc__help', id: ids.help }, t(field.helpKey)),
        error === undefined ? null : h('span', { className: 'dsh-soc__error', id: ids.error, role: 'alert' }, fieldErrorText(field, error, t)),
      );
    }

    function TextAreaField({ field, value, error, disabled, onChange, t }) {
      const ids = useMemo(() => createIds(field), [field]);
      const describedBy = [field.helpKey === undefined ? undefined : ids.help, error === undefined ? undefined : ids.error].filter(Boolean).join(' ');
      return h('div', { className: 'dsh-soc__field' },
        h('label', { className: 'dsh-soc__label', htmlFor: ids.input }, t(field.labelKey), h(RequiredMark, { field })),
        h('textarea', {
          id: ids.input,
          className: 'dsh-soc__textarea',
          rows: field.rows ?? 3,
          maxLength: field.maxLength,
          value,
          disabled,
          required: requiredField(field) || undefined,
          'aria-required': requiredField(field) ? 'true' : undefined,
          'aria-invalid': error === undefined ? undefined : 'true',
          'aria-describedby': describedBy === '' ? undefined : describedBy,
          onChange: event => onChange(event.target.value),
        }),
        field.helpKey === undefined ? null : h('span', { className: 'dsh-soc__help', id: ids.help }, t(field.helpKey)),
        error === undefined ? null : h('span', { className: 'dsh-soc__error', id: ids.error, role: 'alert' }, fieldErrorText(field, error, t)),
      );
    }

    function SelectField({ field, value, error, disabled, onChange, t }) {
      const ids = useMemo(() => createIds(field), [field]);
      const describedBy = [field.helpKey === undefined ? undefined : ids.help, error === undefined ? undefined : ids.error].filter(Boolean).join(' ');
      return h('div', { className: 'dsh-soc__field' },
        h('label', { className: 'dsh-soc__label', htmlFor: ids.input }, t(field.labelKey), h(RequiredMark, { field })),
        h('select', {
          id: ids.input,
          className: 'dsh-soc__select',
          value,
          disabled,
          required: requiredField(field) || undefined,
          'aria-required': requiredField(field) ? 'true' : undefined,
          'aria-invalid': error === undefined ? undefined : 'true',
          'aria-describedby': describedBy === '' ? undefined : describedBy,
          onChange: event => onChange(event.target.value),
        }, field.options.map(option => h('option', { key: option.value, value: option.value }, t(option.labelKey)))),
        field.helpKey === undefined ? null : h('span', { className: 'dsh-soc__help', id: ids.help }, t(field.helpKey)),
        error === undefined ? null : h('span', { className: 'dsh-soc__error', id: ids.error, role: 'alert' }, fieldErrorText(field, error, t)),
      );
    }

    function SwitchField({ field, checked, disabled, onChange, t }) {
      const ids = useMemo(() => createIds(field), [field]);
      return h('div', { className: 'dsh-soc__field' },
        h('div', { className: 'dsh-soc__switch-row' },
          h('span', { className: 'dsh-soc__switch-copy' },
            h('span', { className: 'dsh-soc__label', id: ids.input }, t(field.labelKey)),
            field.helpKey === undefined ? null : h('span', { className: 'dsh-soc__help', id: ids.help }, t(field.helpKey)),
          ),
          h('button', {
            type: 'button',
            className: 'dsh-soc__switch',
            role: 'switch',
            'aria-checked': checked,
            'aria-labelledby': ids.input,
            'aria-describedby': field.helpKey === undefined ? undefined : ids.help,
            disabled,
            onClick: () => onChange(!checked),
          }, h('span', { className: 'dsh-soc__knob', 'aria-hidden': 'true' })),
        ),
      );
    }

    function GatesField({ field, values, disabled, onChange, t }) {
      const ids = useMemo(() => createIds(field), [field]);
      return h('fieldset', {
        className: 'dsh-soc__field',
        style: { margin: 0, padding: 0, border: 0 },
        'aria-describedby': field.helpKey === undefined ? undefined : ids.help,
      },
        h('legend', { className: 'dsh-soc__label', id: ids.input }, t(field.labelKey)),
        h('div', { className: 'dsh-soc__gates' }, field.options.map(option => {
          const checked = values.includes(option.value);
          return h('label', { key: option.value, className: 'dsh-soc__gate' },
            h('input', {
              type: 'checkbox',
              checked,
              disabled,
              onChange: () => onChange(checked ? values.filter(item => item !== option.value) : [...values, option.value]),
            }),
            h('span', null, t(option.labelKey)),
          );
        })),
        field.helpKey === undefined ? null : h('span', { className: 'dsh-soc__help', id: ids.help }, t(field.helpKey)),
      );
    }

    function Field({ field, draft, errors, disabled, onChange, t }) {
      const value = draft[field.path];
      const error = errors[field.path];
      if (field.kind === 'switch') {
        return h(SwitchField, { field, checked: value === true, disabled, onChange: next => onChange(field.path, next), t });
      }
      if (field.kind === 'gates') {
        return h(GatesField, { field, values: Array.isArray(value) ? value : [], disabled, onChange: next => onChange(field.path, next), t });
      }
      if (field.kind === 'select') {
        return h(SelectField, { field, value, error, disabled, onChange: next => onChange(field.path, next), t });
      }
      if (field.kind === 'lines' || field.kind === 'textarea') {
        return h(TextAreaField, { field, value, error, disabled, onChange: next => onChange(field.path, next), t });
      }
      return h(TextField, { field, value, error, disabled, onChange: next => onChange(field.path, next), t });
    }

    function Section({ section, draft, errors, disabled, onChange, t }) {
      const regular = section.fields.filter(field => field.advanced !== true);
      const advanced = section.fields.filter(field => field.advanced === true);
      return h('section', { className: 'dsh-soc__section' },
        h('h5', { className: 'dsh-soc__label', style: { margin: 0, fontSize: '13px' } }, t(section.titleKey)),
        h('div', { className: 'dsh-soc__fields' }, regular.map(field => h(Field, {
          key: field.path, field, draft, errors, disabled, onChange, t,
        }))),
        advanced.length === 0 ? null : h('details', { className: 'dsh-soc__advanced' },
          h('summary', null, t(section.advancedLabelKey ?? 'advanced')),
          h('div', { className: 'dsh-soc__fields' }, advanced.map(field => h(Field, {
            key: field.path, field, draft, errors, disabled, onChange, t,
          }))),
        ),
      );
    }

    function SettingsForm({ t, titleKey, introKey, fields, sections }) {
      const [status, setStatus] = useState('loading');
      const [values, setValues] = useState(undefined);
      const [draft, setDraft] = useState(undefined);
      const [fingerprint, setFingerprint] = useState(undefined);
      const [isDefault, setIsDefault] = useState(false);
      const [reason, setReason] = useState(undefined);
      const [errors, setErrors] = useState({});
      const [notice, setNotice] = useState(undefined);
      const [pending, setPending] = useState(null);
      const [confirming, setConfirming] = useState(false);
      const [conflict, setConflict] = useState(undefined);
      const alive = useRef(true);

      const applySnapshot = snapshot => {
        setValues(snapshot.values);
        setDraft(valuesToDraft(snapshot.values, fields));
        setFingerprint(snapshot.fingerprint);
        setIsDefault(snapshot.isDefault === true);
        setReason(snapshot.reason);
        setStatus(snapshot.editable === false ? 'readonly' : 'ready');
        setConflict(undefined);
      };

      const load = () => {
        const controller = new AbortController();
        setStatus('loading');
        setNotice(undefined);
        setConflict(undefined);
        requestJson(endpointUrl('config'), { signal: controller.signal }).then(({ response, body }) => {
          if (!alive.current) return;
          if (!response.ok || body === undefined || body.ok !== true) {
            setStatus('error');
            setNotice({ tone: 'error', text: loadFailureText(response.status, body, t) });
            return;
          }
          applySnapshot(body);
        }).catch(error => {
          if (!alive.current || error?.name === 'AbortError') return;
          setStatus('error');
          setNotice({ tone: 'error', text: t('error.load', { message: error instanceof Error ? error.message : '' }) });
        });
        return controller;
      };

      useEffect(() => {
        alive.current = true;
        const controller = load();
        return () => {
          alive.current = false;
          controller.abort();
        };
      }, []);

      const readOnly = status === 'readonly';
      const busy = readOnly || pending !== null;
      const blocked = busy || conflict !== undefined;
      const dirty = draft !== undefined && JSON.stringify(draft) !== JSON.stringify(valuesToDraft(values, fields));

      const change = (path, next) => {
        setDraft(current => ({ ...current, [path]: next }));
        setErrors(current => {
          if (current[path] === undefined) return current;
          const nextErrors = { ...current };
          delete nextErrors[path];
          return nextErrors;
        });
        setNotice(undefined);
      };

      const focusFirstError = nextErrors => {
        const first = fields.find(field => nextErrors[field.path] !== undefined);
        if (first === undefined) return;
        const element = document.getElementById(createIds(first).input);
        if (element === null || typeof element.focus !== 'function') return;
        element.scrollIntoView?.({ block: 'center' });
        element.focus();
      };

      const markTerminal = code => {
        const nextReason = terminalReason(code);
        if (nextReason === undefined) return false;
        setStatus('readonly');
        setReason(nextReason);
        return true;
      };

      const save = async (expected = fingerprint) => {
        const nextErrors = validateDraft(draft, fields);
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length > 0) {
          focusFirstError(nextErrors);
          return;
        }
        setConfirming(false);
        setConflict(undefined);
        setPending('save');
        setNotice(undefined);
        try {
          const { response, body } = await requestJson(endpointUrl('config'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fingerprint: expected, values: draftToValues(draft, fields) }),
          });
          if (!alive.current) return;
          if (response.ok && body?.ok === true) {
            applySnapshot(body);
            setNotice({ tone: 'success', text: t('notice.saved') });
            return;
          }
          if (response.status === 409 && body?.code === 'stale' && body.values !== undefined) {
            if (body.editable === false) {
              markTerminal(body.reason ?? 'inactive');
              setNotice({ tone: 'error', text: failureText(response.status, body, t) });
              return;
            }
            setConflict(body);
            setNotice({ tone: 'error', text: t('notice.stale') });
            return;
          }
          markTerminal(body?.code);
          setNotice({ tone: 'error', text: failureText(response.status, body, t) });
        } catch (error) {
          if (!alive.current) return;
          setNotice({ tone: 'error', text: t('notice.failed', { message: error instanceof Error ? error.message : '' }) });
        } finally {
          if (alive.current) setPending(null);
        }
      };

      const reset = async () => {
        setConfirming(false);
        setConflict(undefined);
        setPending('reset');
        setNotice(undefined);
        try {
          const { response, body } = await requestJson(endpointUrl('reset'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fingerprint }),
          });
          if (!alive.current) return;
          if (response.ok && body?.ok === true) {
            applySnapshot(body);
            setNotice({ tone: 'success', text: t('notice.reset') });
            return;
          }
          if (response.status === 409 && body?.code === 'stale' && body.values !== undefined) {
            if (body.editable === false) {
              markTerminal(body.reason ?? 'inactive');
              setNotice({ tone: 'error', text: failureText(response.status, body, t) });
              return;
            }
            applySnapshot(body);
            setNotice({ tone: 'error', text: t('notice.resetStale') });
            return;
          }
          markTerminal(body?.code);
          setNotice({ tone: 'error', text: failureText(response.status, body, t) });
        } catch (error) {
          if (!alive.current) return;
          setNotice({ tone: 'error', text: t('notice.failed', { message: error instanceof Error ? error.message : '' }) });
        } finally {
          if (alive.current) setPending(null);
        }
      };

      const reloadLatest = () => {
        if (conflict === undefined) return;
        applySnapshot(conflict);
        setNotice(undefined);
      };

      const overwrite = () => {
        if (conflict === undefined) return;
        const fresh = conflict;
        setFingerprint(fresh.fingerprint);
        setIsDefault(fresh.isDefault === true);
        setConflict(undefined);
        setNotice(undefined);
        void save(fresh.fingerprint);
      };

      const discard = () => {
        if (values === undefined) return;
        setDraft(valuesToDraft(values, fields));
        setErrors({});
        setConflict(undefined);
        setNotice(undefined);
      };

      return h('div', { className: 'dsh-soc' },
        h('style', null, CSS),
        h('div', { className: 'dsh-soc__head' },
          h('h4', { className: 'dsh-soc__title' }, t(titleKey)),
          introKey === undefined ? null : h('p', { className: 'dsh-soc__intro' }, t(introKey)),
        ),
        status === 'loading' ? h('div', { className: 'dsh-soc__state', role: 'status' }, t('state.loading')) : null,
        status === 'error' ? h('div', { className: 'dsh-soc__state' },
          h('button', { type: 'button', className: 'dsh-soc__button', onClick: () => { load(); } }, t('state.retry')),
        ) : null,
        status === 'readonly' ? h('p', { className: 'dsh-soc__muted', role: 'status' }, readOnlyText(reason, t)) : null,
        notice === undefined ? null : h('p', {
          className: 'dsh-soc__notice',
          'data-tone': notice.tone,
          role: notice.tone === 'error' ? 'alert' : 'status',
        }, notice.text),
        conflict === undefined ? null : h('div', { className: 'dsh-soc__conflict', role: 'group', 'aria-label': t('conflict.title') },
          h('span', null, t('conflict.intro')),
          h('button', {
            type: 'button',
            className: 'dsh-soc__button',
            disabled: busy,
            onClick: reloadLatest,
          }, t('conflict.reload')),
          h('button', {
            type: 'button',
            className: 'dsh-soc__button dsh-soc__button--primary',
            disabled: busy,
            onClick: overwrite,
          }, t('conflict.overwrite')),
        ),
        draft === undefined ? null : h(React.Fragment, null,
          sections.map(section => h(Section, {
            key: section.titleKey, section, draft, errors, disabled: busy, onChange: change, t,
          })),
          h('div', { className: 'dsh-soc__actions' },
            h('button', {
              type: 'button',
              className: 'dsh-soc__button dsh-soc__button--primary',
              disabled: blocked || !dirty,
              onClick: () => { void save(); },
            }, pending === 'save' ? t('action.saving') : t('action.save')),
            h('button', {
              type: 'button',
              className: 'dsh-soc__button',
              disabled: blocked || isDefault,
              onClick: () => { setConfirming(true); },
            }, t('action.reset')),
            dirty ? h('button', {
              type: 'button',
              className: 'dsh-soc__button',
              disabled: busy,
              onClick: discard,
            }, t('action.discard')) : null,
          ),
          confirming ? h('div', { className: 'dsh-soc__confirm', role: 'group', 'aria-labelledby': 'dsh-soc-reset-question' },
            h('span', { id: 'dsh-soc-reset-question' }, t('action.confirmReset')),
            h('button', {
              type: 'button',
              className: 'dsh-soc__button dsh-soc__button--danger',
              disabled: pending !== null,
              onClick: () => { void reset(); },
            }, pending === 'reset' ? t('action.resetting') : t('action.confirm')),
            h('button', {
              type: 'button',
              className: 'dsh-soc__button',
              disabled: pending !== null,
              onClick: () => { setConfirming(false); },
            }, t('action.cancel')),
          ) : null,
        ),
      );
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        const BundlePage = props => props?.view === 'summary' ? null : h(SettingsForm, {
          t,
          titleKey: 'section.title',
          introKey: 'section.intro',
          fields: FIELDS,
          sections: SECTIONS,
        });
        const RowPage = props => props?.view === 'summary'
          ? h('span', null, t('summary'))
          : h(SettingsForm, {
            t,
            titleKey: 'section.title',
            introKey: 'section.intro',
            fields: FIELDS,
            sections: SECTIONS,
          });
        ctx.effect(() => ctx.locale.register(NS, { en: EN, es: ES }), 'subagent-opencode: settings dictionaries');
        ctx.effect(() => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: BUNDLE_KEY,
          locale: NS,
          inject: () => ({}),
        }, BundlePage)), 'subagent-opencode: bundle settings page');
        ctx.effect(() => ctx.slots.inject('plugins.row.config', () => ctx.slots.register({
          name: 'plugins.row.config',
          key: ROW_KEY,
          locale: NS,
          inject: () => ({}),
        }, RowPage)), 'subagent-opencode: row settings page');
      },
      __test: {
        PKG,
        ROW_ID,
        NS,
        ROUTE,
        BUNDLE_KEY,
        ROW_KEY,
        FIELDS,
        SECTIONS,
        dictionaries: { en: EN, es: ES },
        valuesToDraft,
        draftToValues,
        validateDraft,
        getPath,
        setPath,
        terminalReason,
        readOnlyText,
        loadFailureText,
      },
    };
  },
});
