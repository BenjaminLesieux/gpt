export interface CommitAuthor {
  name: string;
  email: string;
  timestamp: number;
}

export interface Commit {
  hash: string;
  shortHash: string;
  message: string;
  author: CommitAuthor;
  parentHashes: string[];
}

export interface Branch {
  name: string;
  headHash: string;
  isCurrent: boolean;
}

export interface RepoStatus {
  branch: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  hasConflicts: boolean;
}
