export interface SiteAdapter {
  match(hostname: string): boolean;
  findComposerContainer(): HTMLElement | null;
  findEditableField(): HTMLElement | null;
  getText(el: HTMLElement): string;
  setText(el: HTMLElement, text: string): void;
  mountToolbar(container: HTMLElement): void;
}
