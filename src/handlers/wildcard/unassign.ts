import { getBotConfig, getLogger } from "../../bindings";
import { GLOBAL_STRINGS } from "../../configs/strings";
import {
  addCommentToIssue,
  getCommentsOfIssue,
  getCommitsOnPullRequest,
  getOpenedPullRequestsForAnIssue,
  listIssuesForRepo,
  removeAssignees,
} from "../../helpers";
import { Comment, IssueType } from "../../types";

/**
 * @dev Check out the bounties which haven't been completed within the initial timeline
 *  and try to release the bounty back to dev pool
 */
export const checkBountiesToUnassign = async () => {
  const logger = getLogger();
  logger.info(`Getting all the issues...`);

  // List all the issues in the repository. It may include `pull_request`
  // because GitHub's REST API v3 considers every pull request an issue
  const issues_opened = await listIssuesForRepo(IssueType.OPEN);

  const assigned_issues = issues_opened.filter((issue) => issue.assignee);

  // Checking the bounties in parallel
  const res = await Promise.all(assigned_issues.map(async (issue) => checkBountyToUnassign(issue)));
  logger.info(`Checking expired bounties done! total: ${res.length}, unassigned: ${res.filter((i) => i).length}`);
};

const checkBountyToUnassign = async (issue: any): Promise<boolean> => {
  const logger = getLogger();
  const {
    unassign: { followUpTime, disqualifyTime },
  } = getBotConfig();
  logger.info(`Checking the bounty to unassign, issue_number: ${issue.number}`);
  const { unassignComment, askUpdate } = GLOBAL_STRINGS;
  const assignees = issue.assignees.map((i: any) => i.login);
  const comments = await getCommentsOfIssue(issue.number);
  if (!comments || comments.length == 0) return false;

  const askUpdateComments = comments
    .filter((comment: Comment) => comment.body.includes(askUpdate))
    .sort((a: Comment, b: Comment) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const lastAskTime = askUpdateComments.length > 0 ? new Date(askUpdateComments[0].created_at).getTime() : new Date(issue.created_at).getTime();
  const curTimestamp = new Date().getTime();
  const lastActivity = await lastActivityTime(issue);
  const passedDuration = curTimestamp - lastActivity.getTime();

  if (passedDuration >= disqualifyTime || passedDuration >= followUpTime) {
    if (passedDuration >= disqualifyTime) {
      logger.info(
        `Unassigning... lastActivityTime: ${lastActivity.getTime()}, curTime: ${curTimestamp}, passedDuration: ${passedDuration}, followUpTime: ${followUpTime}, disqualifyTime: ${disqualifyTime}`
      );
      // remove assignees from the issue
      await removeAssignees(issue.number, assignees);
      await addCommentToIssue(`${unassignComment} \nLast activity time: ${lastActivity}`, issue.number);

      return true;
    } else if (passedDuration >= followUpTime) {
      logger.info(
        `Asking for updates... lastActivityTime: ${lastActivity.getTime()}, curTime: ${curTimestamp}, passedDuration: ${passedDuration}, followUpTime: ${followUpTime}, disqualifyTime: ${disqualifyTime}`
      );

      if (lastAskTime > lastActivity.getTime()) {
        logger.info(
          `Skipping posting an update message cause its been already asked, lastAskTime: ${lastAskTime}, lastActivityTime: ${lastActivity.getTime()}`
        );
      } else
        await addCommentToIssue(
          `${askUpdate} @${assignees[0]}? If you would like to release the bounty back to the DevPool, please comment \`/unassign\` \nLast activity time: ${lastActivity}`,
          issue.number
        );
    }
  }

  return false;
};

const lastActivityTime = async (issue: any): Promise<Date> => {
  const logger = getLogger();
  logger.info(`Checking the latest activity for the issue, issue_number: ${issue.number}`);
  const assignees = issue.assignees.map((i: any) => i.login);
  const activities: Date[] = [new Date(issue.created_at)];

  // get last comment on the issue
  const lastCommentsOfHunterForIssue = (await getCommentsOfIssue(issue.number))
    .filter((comment) => assignees.includes(comment.user.login))
    .sort((a: Comment, b: Comment) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (lastCommentsOfHunterForIssue.length > 0) activities.push(new Date(lastCommentsOfHunterForIssue[0].created_at));

  const openedPrsForIssue = await getOpenedPullRequestsForAnIssue(issue.number, assignees[0]);
  const pr = openedPrsForIssue.length > 0 ? openedPrsForIssue[0] : undefined;
  // get last commit and last comment on the linked pr
  if (pr) {
    const commits = (await getCommitsOnPullRequest(pr.number)).sort(
      (a, b) => new Date(b.commit.committer?.date!).getTime() - new Date(a.commit.committer?.date!).getTime()
    );
    const prComments = (await getCommentsOfIssue(pr.number))
      .filter((comment) => comment.user.login === assignees[0])
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    if (commits.length > 0) activities.push(new Date(commits[0].commit.committer?.date!));
    if (prComments.length > 0) activities.push(new Date(prComments[0].created_at));
  }

  activities.sort((a, b) => b.getTime() - a.getTime());

  return activities[0];
};
