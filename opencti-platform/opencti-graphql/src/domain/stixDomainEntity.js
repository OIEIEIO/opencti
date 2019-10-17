import { dissoc, head, join, map, tail } from 'ramda';
import uuid from 'uuid/v4';
import { Logger as logger } from 'winston';
import { delEditContext, setEditContext } from '../database/redis';
import {
  commitWriteTx,
  createRelation,
  dayFormat,
  deleteEntityById,
  deleteRelationById,
  escape,
  escapeString,
  getById,
  getId,
  monthFormat,
  notify,
  graknNow,
  paginate,
  prepareDate,
  takeWriteTx,
  timeSeries,
  updateAttribute,
  yearFormat
} from '../database/grakn';
import {
  countEntities,
  deleteEntity,
  paginate as elPaginate
} from '../database/elasticSearch';

import { BUS_TOPICS } from '../config/conf';
import { generateFileExportName, upload } from '../database/minio';
import { connectorsForExport } from './connector';
import { createWork, workToExportFile } from './work';
import { pushToConnector } from '../database/rabbitmq';

export const findAll = args => elPaginate('stix_domain_entities', args);

export const stixDomainEntitiesTimeSeries = args => {
  return timeSeries(
    `match $x isa ${args.type ? escape(args.type) : 'Stix-Domain-Entity'}`,
    args
  );
};

export const stixDomainEntitiesNumber = args => ({
  count: countEntities('stix_domain_entities', args),
  total: countEntities('stix_domain_entities', dissoc('endDate', args))
});

export const findById = stixDomainEntityId => getById(stixDomainEntityId);

export const findByStixId = args => {
  return paginate(
    `match $x isa ${args.type ? escape(args.type) : 'Stix-Domain-Entity'};
    $x has stix_id "${escapeString(args.stix_id)}"`,
    args,
    false
  );
};

export const findByName = args => {
  return paginate(
    `match $x isa ${args.type ? escape(args.type) : 'Stix-Domain-Entity'};
   $x has name $name;
   $x has alias $alias;
   { $name "${escapeString(args.name)}"; } or
   { $alias "${escapeString(args.name)}"; }`,
    args,
    false
  );
};

export const findByExternalReference = args => {
  return paginate(
    `match $x isa ${args.type ? escape(args.type) : 'Stix-Domain-Entity'};
     $rel(external_reference:$externalReference, so:$x) isa external_references;
     $externalReference has internal_id "${escapeString(
       args.externalReferenceId
     )}"`,
    args,
    false
  );
};

export const killChainPhases = (stixDomainEntityId, args) => {
  return paginate(
    `match $k isa Kill-Chain-Phase; 
    $rel(kill_chain_phase:$k, phase_belonging:$x) isa kill_chain_phases; 
    $x has internal_id "${escapeString(stixDomainEntityId)}"`,
    args,
    false,
    false
  );
};

export const reportsTimeSeries = (stixDomainEntityId, args) => {
  return timeSeries(
    `match $x isa Report; 
    $rel(knowledge_aggregation:$x, so:$so) isa object_refs; 
    $so has internal_id "${escapeString(stixDomainEntityId)}"`,
    args
  );
};

export const externalReferences = (stixDomainEntityId, args) => {
  return paginate(
    `match $e isa External-Reference; 
    $rel(external_reference:$e, so:$x) isa external_references; 
    $x has internal_id "${escapeString(stixDomainEntityId)}"`,
    args,
    false
  );
};

const askJobExports = async (entity, format, exportType) => {
  const connectors = await connectorsForExport(format, true);
  // Create job for
  const workList = await Promise.all(
    map(connector => {
      const fileName = generateFileExportName(
        format,
        connector,
        exportType,
        entity
      );
      return createWork(connector, entity.id, fileName).then(work => ({
        connector,
        work
      }));
    }, connectors)
  );
  // Send message to all correct connectors queues
  await Promise.all(
    map(data => {
      const { connector, work } = data;
      const message = {
        job_id: work.internal_id, // job(id)
        export_type: exportType, // simple or full
        entity_type: entity.entity_type, // report, threat, ...
        entity_id: entity.id, // report(id), thread(id), ...
        file_name: work.work_file // Base path for the upload
      };
      return pushToConnector(connector, message);
    }, workList)
  );
  return workList;
};

export const stixDomainEntityImportPush = (user, entityId, file) => {
  return upload(user, 'import', file, entityId);
};

/**
 * Create export element waiting for completion
 * @param domainEntityId
 * @param format
 * @param exportType > stix2-bundle-full | stix2-bundle-simple
 * @returns {*}
 */
export const stixDomainEntityExportAsk = async (
  domainEntityId,
  format,
  exportType
) => {
  const entity = await getById(domainEntityId);
  const workList = await askJobExports(entity, format, exportType);
  // Return the work list to do
  return map(w => workToExportFile(w.work, w.connector), workList);
};

export const stixDomainEntityExportPush = async (
  user,
  entityId,
  jobId,
  file
) => {
  // Upload the document in minio
  await upload(user, 'export', file, entityId);
  return getById(entityId).then(stixDomainEntity => {
    notify(BUS_TOPICS.StixDomainEntity.EDIT_TOPIC, stixDomainEntity, user);
    return true;
  });
};

export const addStixDomainEntity = async (user, stixDomainEntity) => {
  const wTx = await takeWriteTx();
  const internalId = stixDomainEntity.internal_id
    ? escapeString(stixDomainEntity.internal_id)
    : uuid();
  const query = `insert $stixDomainEntity isa ${escape(stixDomainEntity.type)},
    has internal_id "${internalId}",
    has entity_type "${escapeString(stixDomainEntity.type.toLowerCase())}",
    has stix_id "${
      stixDomainEntity.stix_id
        ? escapeString(stixDomainEntity.stix_id)
        : `${escapeString(stixDomainEntity.type.toLowerCase())}--${uuid()}`
    }",
    has stix_label "",
    ${
      stixDomainEntity.alias
        ? `${join(
            ' ',
            map(
              val => `has alias "${escapeString(val)}",`,
              tail(stixDomainEntity.alias)
            )
          )} has alias "${escapeString(head(stixDomainEntity.alias))}",`
        : ''
    }
    has name "${escapeString(stixDomainEntity.name)}",
    has description "${escapeString(stixDomainEntity.description)}",
    has created ${
      stixDomainEntity.created
        ? prepareDate(stixDomainEntity.created)
        : graknNow()
    },
    has modified ${
      stixDomainEntity.modified
        ? prepareDate(stixDomainEntity.modified)
        : graknNow()
    },
    has revoked false,
    has created_at ${graknNow()},
    has created_at_day "${dayFormat(graknNow())}",
    has created_at_month "${monthFormat(graknNow())}",
    has created_at_year "${yearFormat(graknNow())}",      
    has updated_at ${graknNow()};
  `;
  logger.debug(`[GRAKN - infer: false] addStixDomainEntity > ${query}`);
  const stixDomainEntityIterator = await wTx.tx.query(query);
  const createStixDomainEntity = await stixDomainEntityIterator.next();
  const createdStixDomainEntityId = await createStixDomainEntity
    .map()
    .get('stixDomainEntity').id;

  if (stixDomainEntity.createdByRef) {
    await wTx.tx.query(
      `match $from id ${createdStixDomainEntityId};
      $to has internal_id "${escapeString(stixDomainEntity.createdByRef)}";
      insert (so: $from, creator: $to)
      isa created_by_ref, has internal_id "${uuid()}";`
    );
  }

  if (stixDomainEntity.markingDefinitions) {
    const createMarkingDefinition = markingDefinition =>
      wTx.tx.query(
        `match $from id ${createdStixDomainEntityId}; 
        $to has internal_id "${escapeString(markingDefinition)}"; 
        insert (so: $from, marking: $to) isa object_marking_refs, has internal_id "${uuid()}";`
      );
    const markingDefinitionsPromises = map(
      createMarkingDefinition,
      stixDomainEntity.markingDefinitions
    );
    await Promise.all(markingDefinitionsPromises);
  }

  await commitWriteTx(wTx);

  return getById(internalId).then(created => {
    return notify(BUS_TOPICS.StixDomainEntity.ADDED_TOPIC, created, user);
  });
};

export const stixDomainEntityDelete = async stixDomainEntityId => {
  const graknId = await getId(stixDomainEntityId);
  await deleteEntity('stix_domain_entities', graknId);
  return deleteEntityById(stixDomainEntityId);
};

export const stixDomainEntityAddRelation = (user, stixDomainEntityId, input) =>
  createRelation(stixDomainEntityId, input).then(relationData => {
    notify(BUS_TOPICS.StixDomainEntity.EDIT_TOPIC, relationData.node, user);
    return relationData;
  });

export const stixDomainEntityAddRelations = async (
  user,
  stixDomainEntityId,
  input
) => {
  const finalInput = map(
    n => ({
      toId: n,
      fromRole: input.fromRole,
      toRole: input.toRole,
      through: input.through
    }),
    input.toIds
  );

  const wTx = await takeWriteTx();
  const createRelationPromise = relationInput =>
    createRelation(stixDomainEntityId, relationInput);
  const relationsPromises = map(createRelationPromise, finalInput);
  await Promise.all(relationsPromises);

  await commitWriteTx(wTx);

  return getById(stixDomainEntityId, true).then(stixDomainEntity =>
    notify(BUS_TOPICS.Workspace.EDIT_TOPIC, stixDomainEntity, user)
  );
};

export const stixDomainEntityDeleteRelation = (
  user,
  stixDomainEntityId,
  relationId
) =>
  deleteRelationById(stixDomainEntityId, relationId).then(relationData => {
    notify(BUS_TOPICS.StixDomainEntity.EDIT_TOPIC, relationData.node, user);
    return relationData;
  });

export const stixDomainEntityCleanContext = (user, stixDomainEntityId) => {
  delEditContext(user, stixDomainEntityId);
  return getById(stixDomainEntityId).then(stixDomainEntity =>
    notify(BUS_TOPICS.StixDomainEntity.EDIT_TOPIC, stixDomainEntity, user)
  );
};

export const stixDomainEntityEditContext = (
  user,
  stixDomainEntityId,
  input
) => {
  setEditContext(user, stixDomainEntityId, input);
  return getById(stixDomainEntityId).then(stixDomainEntity =>
    notify(BUS_TOPICS.StixDomainEntity.EDIT_TOPIC, stixDomainEntity, user)
  );
};

export const stixDomainEntityEditField = (user, stixDomainEntityId, input) =>
  updateAttribute(stixDomainEntityId, input).then(stixDomainEntity => {
    return notify(
      BUS_TOPICS.StixDomainEntity.EDIT_TOPIC,
      stixDomainEntity,
      user
    );
  });
