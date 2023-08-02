/*
 * Copyright (c) 2023, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import { expect, config } from 'chai';
import {
  profileRewriter,
  CorrectedProfile,
  fieldCorrections,
  profileObjectToString,
  profileStringToProfile,
} from '../../src/package/profileRewriter';

config.truncateThreshold = 0;

const sampleProfile: Partial<CorrectedProfile> = {
  userLicense: 'Salesforce',
  // something that should be removed when packaging profiles
  custom: true,
  pageAccesses: [
    {
      apexPage: 'Foo',
      enabled: true,
    },
  ],
  objectPermissions: [
    {
      object: 'Foo__c',
      allowRead: true,
    },
    {
      object: 'Bar__c',
      allowRead: true,
    },
    // this one should be removed because it's not in the manifest
    {
      object: 'Baz__c',
      allowRead: true,
    },
  ],
  fieldPermissions: [
    {
      field: 'Foo__c.Foo_Field__c',
      readable: true,
      editable: true,
    },
    {
      field: 'Event.Event_Field__c',
      readable: true,
      editable: true,
    },
    {
      field: 'Task.Task_Field__c',
      readable: true,
      editable: true,
    },
    // this one should be removed because it's not in the manifest
    {
      field: 'Foo__c.Omit__c',
      readable: true,
      editable: true,
    },
    {
      field: 'Foo__c.Omit2__c',
      readable: true,
      editable: true,
    },
  ],
};

const sampleManifest = new Map<string, string[]>([
  ['CustomObject', ['Foo__c', 'Bar__c']],
  ['CustomField', ['Foo__c.Foo_Field__c', 'Activity.Event_Field__c', 'Activity.Task_Field__c']],
]);

describe('reading and writing profiles', () => {
  it('reads a profile with single-item nodes', () => {
    const profileJson: Partial<CorrectedProfile> = {
      objectPermissions: [
        {
          object: 'Foo__c',
          allowRead: true,
        },
      ],
    };
    const xml = profileObjectToString(profileJson);
    const json = profileStringToProfile(xml);
    expect(json.objectPermissions).to.deep.equal([{ object: 'Foo__c', allowRead: 'true' }]);
  });
  it('writes include the outer object, xmlns and declaration', () => {
    const objectContents: Partial<CorrectedProfile> = {
      objectPermissions: [
        {
          object: 'Foo__c',
          allowRead: true,
        },
      ],
    };
    const result = profileObjectToString(objectContents);
    expect(result).to.include('<Profile xmlns="http://soap.sforce.com/2006/04/metadata">');
    expect(result).to.include('<?xml version="1.0" encoding="UTF-8"?>');
  });
});

describe('fieldCorrections', () => {
  it('event and task => activity', () => {
    expect(fieldCorrections('Event.Event_Field__c')).to.equal('Activity.Event_Field__c');
    expect(fieldCorrections('Task.Task_Field__c')).to.equal('Activity.Task_Field__c');
  });
  it('does not change other fields', () => {
    expect(fieldCorrections('Foo__c.Foo_Field__c')).to.equal('Foo__c.Foo_Field__c');
  });
});

describe('profileRewriter', () => {
  describe('user license', () => {
    it('retains userLicense when retainUserLicense is true', () => {
      expect(profileRewriter(sampleProfile as CorrectedProfile, sampleManifest, true)).to.have.property('userLicense');
    });
    it('omits userLicense when retainUserLicense is false', () => {
      expect(profileRewriter(sampleProfile as CorrectedProfile, sampleManifest, false)).to.not.have.property(
        'userLicense'
      );
    });
  });
  it('omits properties that are not in the metadata types used for packaging', () => {
    expect(profileRewriter(sampleProfile as CorrectedProfile, sampleManifest, false)).to.not.have.property('custom');
  });
  it('filters objectPermissions for Objects not in the manifest', () => {
    const newProfile = profileRewriter(sampleProfile as CorrectedProfile, sampleManifest, false);
    expect(newProfile).to.have.property('objectPermissions');
    expect(newProfile.objectPermissions).to.deep.equal([
      {
        object: 'Foo__c',
        allowRead: true,
      },
      {
        object: 'Bar__c',
        allowRead: true,
      },
    ]);
  });
  it('filters fieldPermissions for Objects not in the manifest and understands Activity/Event/Task equivalence', () => {
    const newProfile = profileRewriter(sampleProfile as CorrectedProfile, sampleManifest, false);
    expect(newProfile.fieldPermissions).to.deep.equal([
      {
        field: 'Foo__c.Foo_Field__c',
        readable: true,
        editable: true,
      },
      {
        field: 'Event.Event_Field__c',
        readable: true,
        editable: true,
      },
      {
        field: 'Task.Task_Field__c',
        readable: true,
        editable: true,
      },
    ]);
  });
  it('omits properties when there are no values after filtering', () => {
    const newProfile = profileRewriter(
      sampleProfile as CorrectedProfile,
      new Map<string, string[]>([['ApexPage', ['Foo']]]),
      false
    );
    expect(newProfile).to.not.have.property('objectPermissions');
    expect(newProfile).to.not.have.property('fieldPermissions');
    expect(newProfile).to.have.property('pageAccesses');
  });
});
