import { App, Editor, EditorPosition, EditorSelection, EditorRange, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
        mySetting: string;
        apiKey: string;
        voiceId: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
        mySetting: 'default',
        apiKey: '',
        voiceId: ''
}

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-sample-modal-simple',
			name: 'Open sample modal (simple)',
			callback: () => {
				new SampleModal(this.app).open();
			}
		});
                // This adds an editor command that can perform some operation on the current editor instance
                this.addCommand({
                        id: 'sample-editor-command',
                        name: 'Sample editor command',
                        editorCallback: (editor: Editor, view: MarkdownView) => {
                                console.log(editor.getSelection());
                                editor.replaceSelection('Sample Editor Command');
                        }
                });

               this.addCommand({
                       id: 'tts-play-selection',
                       name: 'Play selection with ElevenLabs',
                       editorCallback: async (editor: Editor) => {
                               const text = editor.getSelection() || editor.getValue();
                               if (!text.trim()) {
                                       new Notice('Nothing to read');
                                       return;
                               }
                               const originalSelections = editor.listSelections();
                               let selection = originalSelections[0];
                               if (!editor.getSelection()) {
                                       const start: EditorPosition = {line: 0, ch: 0};
                                       const end: EditorPosition = {line: editor.lastLine(), ch: editor.getLine(editor.lastLine()).length};
                                       editor.setSelection(start, end);
                                       selection = editor.listSelections()[0];
                               }
                               await this.playText(text, editor, selection, originalSelections);
                       }
               });
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'open-sample-modal-complex',
			name: 'Open sample modal (complex)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

        async saveSettings() {
                await this.saveData(this.settings);
        }

       private async playText(text: string, editor: Editor, selection: EditorSelection, originalSelections: EditorSelection[]) {
               try {
                        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${this.settings.voiceId}`, {
                                method: 'POST',
                                headers: {
                                        'Content-Type': 'application/json',
                                        'xi-api-key': this.settings.apiKey,
                                        'Accept': 'audio/mpeg'
                                },
                                body: JSON.stringify({text})
                        });
                        if (!response.ok) {
                                new Notice('Failed to generate speech');
                                return;
                        }
                        const arrayBuffer = await response.arrayBuffer();
                        const blob = new Blob([arrayBuffer], {type: 'audio/mpeg'});
                       const url = URL.createObjectURL(blob);
                       new TTSAudioModal(this.app, url, editor, selection, originalSelections).open();
               } catch (e) {
                       console.error(e);
                       new Notice('Error during text to speech');
               }
       }

       private playAudio(url: string): Promise<void> {
               return new Promise((resolve) => {
                       const audio = new Audio(url);
                       audio.addEventListener('ended', () => resolve());
                       audio.play();
               });
       }
}

class TTSAudioModal extends Modal {
       private url: string;
       private editor: Editor;
       private selection: EditorSelection;
       private original: EditorSelection[];
       private audio!: HTMLAudioElement;
       private wordRanges: EditorRange[] = [];

       constructor(app: App, url: string, editor: Editor, selection: EditorSelection, original: EditorSelection[]) {
               super(app);
               this.url = url;
               this.editor = editor;
               this.selection = selection;
               this.original = original;
       }

       onOpen() {
               const { contentEl } = this;
               this.audio = contentEl.createEl('audio', { attr: { controls: 'true' } });
               this.audio.src = this.url;
               this.wordRanges = this.computeWordRanges();
               this.audio.addEventListener('timeupdate', () => this.updateHighlight());
               this.audio.addEventListener('ended', () => {
                       this.editor.setSelections(this.original);
                       this.close();
               });
               if (this.wordRanges.length > 0) {
                       const first = this.wordRanges[0];
                       this.editor.setSelection(first.from, first.to);
               }
               this.audio.play();
       }

       onClose() {
               this.editor.setSelections(this.original);
               const { contentEl } = this;
               contentEl.empty();
       }

       private computeWordRanges(): EditorRange[] {
               const { anchor, head } = this.selection;
               const from = (anchor.line < head.line || (anchor.line === head.line && anchor.ch <= head.ch)) ? anchor : head;
               const to = from === anchor ? head : anchor;
               const startOffset = this.editor.posToOffset(from);
               const text = this.editor.getRange(from, to);
               const ranges: EditorRange[] = [];
               const re = /\S+/g;
               let match: RegExpExecArray | null;
               while ((match = re.exec(text)) !== null) {
                       const start = this.editor.offsetToPos(startOffset + match.index);
                       const end = this.editor.offsetToPos(startOffset + match.index + match[0].length);
                       ranges.push({ from: start, to: end });
               }
               return ranges;
       }

       private updateHighlight() {
               if (!this.audio.duration || this.wordRanges.length === 0) return;
               const index = Math.min(Math.floor((this.audio.currentTime / this.audio.duration) * this.wordRanges.length), this.wordRanges.length - 1);
               const range = this.wordRanges[index];
               this.editor.setSelection(range.from, range.to);
       }
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

                containerEl.empty();

                new Setting(containerEl)
                        .setName('Setting #1')
                        .setDesc('It\'s a secret')
                        .addText(text => text
                                .setPlaceholder('Enter your secret')
                                .setValue(this.plugin.settings.mySetting)
                                .onChange(async (value) => {
                                        this.plugin.settings.mySetting = value;
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName('ElevenLabs API Key')
                        .setDesc('Required for text to speech')
                        .addText(text => text
                                .setPlaceholder('Enter API key')
                                .setValue(this.plugin.settings.apiKey)
                                .onChange(async (value) => {
                                        this.plugin.settings.apiKey = value.trim();
                                        await this.plugin.saveSettings();
                                }));

                new Setting(containerEl)
                        .setName('Voice ID')
                        .setDesc('ID of the ElevenLabs voice to use')
                        .addText(text => text
                                .setPlaceholder('Voice ID')
                                .setValue(this.plugin.settings.voiceId)
                                .onChange(async (value) => {
                                        this.plugin.settings.voiceId = value.trim();
                                        await this.plugin.saveSettings();
                                }));
        }
}
