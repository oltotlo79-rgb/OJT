export interface ManualFile {
  name: string;
  text: string;
}

export interface BuiltChapter {
  id: string;
  title: string;
  sectionIds: string[];
}

export interface BuiltSection {
  id: string;
  chapterId: string;
  chapterTitle: string;
  title: string;
  html: string;
  printHtml: string;
  text: string;
  hasFigure: boolean;
  imageNames: string[];
}

export interface BuiltManual {
  chapters: BuiltChapter[];
  sections: BuiltSection[];
  helpModule: string;
  printHtml: string;
}

export declare const HELP_IMAGE_WIDTH: number;
export declare const PRODUCT_NAME: string;
export declare function chapterIdOf(fileName: string): string;
export declare function plainText(html: string): string;
export declare function decodeFragment(fragment: string): string;
export declare function buildManual(
  files: readonly ManualFile[],
  builtAt?: string,
  availableImages?: readonly string[],
  edition?: string,
): BuiltManual;
