import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { teamSchema } from '@intellmeet/shared';
import { createApp } from '../../app.js';
import { bearer, createInvite, createTeam, registerUser } from '../../test/fixtures.js';
import { Team } from './team.model.js';

const app = createApp();

describe('POST /api/teams', () => {
  it('creates a team with the creator as its admin', async () => {
    const owner = await registerUser(app);

    const response = await request(app)
      .post('/api/teams')
      .set('Authorization', bearer(owner))
      .send({ name: 'Platform Team' })
      .expect(201);

    expect(teamSchema.safeParse(response.body.team).success).toBe(true);
    expect(response.body.team.name).toBe('Platform Team');
    expect(response.body.team.ownerId).toBe(owner.id);
    // Without this the creator could never invite anyone to their own team.
    expect(response.body.team.myRole).toBe('admin');
    expect(response.body.team.members).toHaveLength(1);
  });

  it('generates a unique slug so two teams can share a name', async () => {
    const owner = await registerUser(app);

    const first = await request(app)
      .post('/api/teams')
      .set('Authorization', bearer(owner))
      .send({ name: 'Design' })
      .expect(201);

    const second = await request(app)
      .post('/api/teams')
      .set('Authorization', bearer(owner))
      .send({ name: 'Design' })
      .expect(201);

    expect(first.body.team.slug).not.toBe(second.body.team.slug);
    expect(first.body.team.slug).toMatch(/^design-/);
  });

  it('requires authentication', async () => {
    await request(app).post('/api/teams').send({ name: 'Nope' }).expect(401);
  });

  it('rejects a name that is too short', async () => {
    const owner = await registerUser(app);

    const response = await request(app)
      .post('/api/teams')
      .set('Authorization', bearer(owner))
      .send({ name: 'x' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('never exposes invite codes in a team response', async () => {
    const owner = await registerUser(app);
    const teamId = await createTeam(app, owner);
    await createInvite(app, owner, teamId);

    const response = await request(app)
      .get(`/api/teams/${teamId}`)
      .set('Authorization', bearer(owner))
      .expect(200);

    expect(JSON.stringify(response.body)).not.toContain('inviteCodes');
    expect(response.body.team).not.toHaveProperty('inviteCodes');
  });
});

describe('GET /api/teams', () => {
  it('lists only the teams the caller belongs to', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);

    await createTeam(app, owner, 'Mine');
    await createTeam(app, stranger, 'Theirs');

    const response = await request(app)
      .get('/api/teams')
      .set('Authorization', bearer(owner))
      .expect(200);

    expect(response.body.teams).toHaveLength(1);
    expect(response.body.teams[0].name).toBe('Mine');
  });
});

describe('GET /api/teams/:id', () => {
  it('returns 404 to a non-member rather than confirming the team exists', async () => {
    const owner = await registerUser(app);
    const stranger = await registerUser(app);
    const teamId = await createTeam(app, owner);

    // 403 would confirm "this team exists, you just cannot see it", which
    // leaks the existence of other tenants' teams.
    const response = await request(app)
      .get(`/api/teams/${teamId}`)
      .set('Authorization', bearer(stranger))
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects a malformed id with a validation error, not a cast crash', async () => {
    const owner = await registerUser(app);

    const response = await request(app)
      .get('/api/teams/not-an-object-id')
      .set('Authorization', bearer(owner))
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('invites', () => {
  it('lets an admin mint a code and a member redeem it', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    const teamId = await createTeam(app, owner);

    const inviteResponse = await request(app)
      .post(`/api/teams/${teamId}/invites`)
      .set('Authorization', bearer(owner))
      .expect(201);

    expect(inviteResponse.body.invite.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(inviteResponse.body.invite.joinPath).toContain(inviteResponse.body.invite.code);

    const joinResponse = await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(joiner))
      .send({ code: inviteResponse.body.invite.code })
      .expect(200);

    expect(joinResponse.body.team.members).toHaveLength(2);
    expect(joinResponse.body.team.myRole).toBe('member');
  });

  it('accepts a lower-case code, since people retype invites by hand', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    const teamId = await createTeam(app, owner);
    const code = await createInvite(app, owner, teamId);

    await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(joiner))
      .send({ code: code.toLowerCase() })
      .expect(200);
  });

  it('is idempotent: joining twice does not duplicate the member', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    const teamId = await createTeam(app, owner);
    const code = await createInvite(app, owner, teamId);

    await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(joiner))
      .send({ code })
      .expect(200);

    const second = await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(joiner))
      .send({ code })
      .expect(200);

    expect(second.body.team.members).toHaveLength(2);
  });

  it('refuses an unknown code', async () => {
    const joiner = await registerUser(app);

    const response = await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(joiner))
      .send({ code: 'ZZZZZZZZ' })
      .expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses an expired code', async () => {
    const owner = await registerUser(app);
    const joiner = await registerUser(app);
    const teamId = await createTeam(app, owner);
    const code = await createInvite(app, owner, teamId);

    await Team.updateOne(
      { _id: teamId, 'inviteCodes.code': code },
      { $set: { 'inviteCodes.$.expiresAt': new Date(Date.now() - 1000) } },
    );

    await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(joiner))
      .send({ code })
      .expect(404);
  });

  it('refuses to mint a code for an ordinary member', async () => {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const teamId = await createTeam(app, owner);
    const code = await createInvite(app, owner, teamId);

    await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(member))
      .send({ code })
      .expect(200);

    const response = await request(app)
      .post(`/api/teams/${teamId}/invites`)
      .set('Authorization', bearer(member))
      .expect(403);

    expect(response.body.error.code).toBe('FORBIDDEN');
  });
});

describe('member management', () => {
  /** Owner + a joined member, the starting point for most of these tests. */
  async function teamWithMember() {
    const owner = await registerUser(app);
    const member = await registerUser(app);
    const teamId = await createTeam(app, owner);
    const code = await createInvite(app, owner, teamId);

    await request(app)
      .post('/api/teams/join')
      .set('Authorization', bearer(member))
      .send({ code })
      .expect(200);

    return { owner, member, teamId };
  }

  it('lets an admin remove a member', async () => {
    const { owner, member, teamId } = await teamWithMember();

    const response = await request(app)
      .delete(`/api/teams/${teamId}/members/${member.id}`)
      .set('Authorization', bearer(owner))
      .expect(200);

    expect(response.body.team.members).toHaveLength(1);

    // The removed user immediately loses visibility of the team.
    await request(app).get(`/api/teams/${teamId}`).set('Authorization', bearer(member)).expect(404);
  });

  it('refuses to remove the owner', async () => {
    const { owner, teamId } = await teamWithMember();

    const response = await request(app)
      .delete(`/api/teams/${teamId}/members/${owner.id}`)
      .set('Authorization', bearer(owner))
      .expect(409);

    // Otherwise ownerId would point at a non-member and the team would have
    // nobody with an unambiguous claim to it.
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('refuses to let a member remove anyone', async () => {
    const { owner, member, teamId } = await teamWithMember();

    await request(app)
      .delete(`/api/teams/${teamId}/members/${owner.id}`)
      .set('Authorization', bearer(member))
      .expect(403);
  });

  it('lets an admin promote a member, who can then invite', async () => {
    const { owner, member, teamId } = await teamWithMember();

    const response = await request(app)
      .patch(`/api/teams/${teamId}/members/${member.id}`)
      .set('Authorization', bearer(owner))
      .send({ role: 'admin' })
      .expect(200);

    const promoted = response.body.team.members.find(
      (entry: { userId: string }) => entry.userId === member.id,
    );
    expect(promoted.role).toBe('admin');

    await request(app)
      .post(`/api/teams/${teamId}/invites`)
      .set('Authorization', bearer(member))
      .expect(201);
  });

  it('refuses to demote the owner', async () => {
    const { owner, teamId } = await teamWithMember();

    await request(app)
      .patch(`/api/teams/${teamId}/members/${owner.id}`)
      .set('Authorization', bearer(owner))
      .send({ role: 'member' })
      .expect(409);
  });

  it('rejects an unknown role value', async () => {
    const { owner, member, teamId } = await teamWithMember();

    const response = await request(app)
      .patch(`/api/teams/${teamId}/members/${member.id}`)
      .set('Authorization', bearer(owner))
      .send({ role: 'superuser' })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('404s when the target is not a member of the team', async () => {
    const { owner, teamId } = await teamWithMember();
    const stranger = await registerUser(app);

    await request(app)
      .delete(`/api/teams/${teamId}/members/${stranger.id}`)
      .set('Authorization', bearer(owner))
      .expect(404);
  });
});
