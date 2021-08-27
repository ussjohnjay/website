import React from 'react';
import { Table, Icon, Rating, Pagination, Dropdown, Form, Button, Checkbox, Header, Modal, Grid } from 'semantic-ui-react';
import { navigate } from 'gatsby';

import { SearchableTable, ITableConfigRow } from '../components/searchabletable';

import { crewMatchesSearchFilter } from '../utils/crewsearch';
import { formatTierLabel } from '../utils/crewutils';
import { getCoolStats } from '../utils/misc';
import { useStateWithStorage } from '../utils/storage';

const tableConfig: ITableConfigRow[] = [
	{ width: 3, column: 'name', title: 'Crew' },
	{ width: 1, column: 'max_rarity', title: 'Rarity', reverse: true },
	{ width: 1, column: 'bigbook_tier', title: 'Tier (Legacy)' },
	{ width: 1, column: 'cab_ov', title: 'CAB', reverse: true },
	{ width: 1, column: 'ranks.voyRank', title: 'Voyage' },
	{ width: 1, column: 'collections.length', title: 'Collections', reverse: true },
	{ width: 1, title: 'Useable Combos' }
];

const ownedFilterOptions = [
    { key: 'ofo0', value: 'Show all crew', text: 'Show all crew' },
    { key: 'ofo1', value: 'Only show unowned crew', text: 'Only show unowned crew' },
    { key: 'ofo2', value: 'Only show owned crew', text: 'Only show owned crew (not FF)' },
    { key: 'ofo3', value: 'Show all owned crew', text: 'Show all owned crew'},
	{ key: 'ofo4', value: 'Show all crew not FF', text: 'Show all crew (not FF)'}
];

const ownedFilters = {
    'Show all crew': data => crew => true,
    'Only show unowned crew': data => crew => !data.some((c) => crew.symbol === c.symbol),
    'Only show owned crew': data => crew => data.some((c) => crew.symbol === c.symbol && c.rarity < c.max_rarity),
    'Show all owned crew': data => crew => data.some(c => crew.symbol === c.symbol),
	'Show all crew not FF': data => crew => !data.some((c) => crew.symbol === c.symbol && c.rarity === c.max_rarity),
};

// TODO: Remove duplication
const rarityLabels = ['Common', 'Uncommon', 'Rare', 'Super Rare', 'Legendary'];

const rarityOptions = [
	{ key: 'ro0', value: null, text: 'Any rarity' },
	{ key: 'ro2', value: '2', text: 'Minimum 2*' },
	{ key: 'ro3', value: '3', text: 'Minimum 3*' },
	{ key: 'ro4', value: '4', text: 'Minimum 4*' },
	{ key: 'ro5', value: '5', text: 'Minimum 5*' }
];

const collectionsOptions = [
	{ key: 'co0', value: null, text: 'None or any' }
];

const filterTraits = (polestar, trait) => {
	if (polestar.filter.type === 'trait') {
		return polestar.filter.trait === trait;
	}
	if (polestar.filter.type === 'rarity') {
		return `crew_max_rarity_${polestar.filter.rarity}` === trait;
	}
	if (polestar.filter.type === 'skill') {
		return polestar.filter.skill === trait;
	}
}

type CrewRetrievalProps = {
	playerData: any;
	allCrew: any;
};

const CrewRetrieval = (props: CrewRetrievalProps) => {
	const { playerData, allCrew } = props;

	const [ownedPolestars, setOwnedPolestars] = React.useState(undefined);

	if (!playerData?.forte_root) {
		return (
			<div>
				<h2>Crew Retrieval Unavailable</h2>
				<p>Crew retrieval requires a <a href="https://stt.disruptorbeam.com/player?client_api=17">newer version</a> of your player file.
				   Please follow the link and copy the correct version to paste.</p>
			</div>
		);
	}

	if (!ownedPolestars) {
		fetch('/structured/keystones.json')
			.then(response => response.json())
			.then(allkeystones => {
				let owned = allkeystones.filter((k) => k.type === 'keystone' && playerData.forte_root.items.some((f) => f.id === k.id));
				owned.forEach((p) => { p.quantity = playerData.forte_root.items.find(k => k.id === p.id).quantity });
				setOwnedPolestars(owned);
			});
		return (<><Icon loading name='spinner' /> Loading...</>);
	}

	// Only need to update collections statuses once
	if (collectionsOptions.length == 1) {
		let cArr = [...new Set(allCrew.map(a => a.collections).flat())].sort();
		cArr.forEach(c => {
			if (!collectionsOptions.find(co => co.value == c)) {
				let pc = { progress: 'n/a', milestone: { goal: 'n/a' }};
				if (playerData.player.character.cryo_collections) {
					let matchedCollection = playerData.player.character.cryo_collections.find((pc) => pc.name === c);
					if (matchedCollection) {
						pc = matchedCollection;
					}
				}
				let kv = cArr.indexOf(c) + 1;
				collectionsOptions.push({
					key: 'co'+kv,
					value: c,
					text: c,
					content: (
						<span>{c} <span style={{ whiteSpace: 'nowrap' }}>({pc.progress} / {pc.milestone.goal || 'max'})</span></span>
					),
				});
			}
		});
	}

	return (<CrewRetrievalTool playerData={playerData} allCrew={JSON.parse(JSON.stringify(allCrew))} ownedPolestars={ownedPolestars} />);
};

type CrewRetrievalToolProps = {
	playerData: any;
	allCrew: any;
	ownedPolestars: any;
};

const CrewRetrievalTool = (props: CrewRetrievalToolProps) => {
	const { playerData, allCrew, ownedPolestars } = props;

	const [disabledPolestars, setDisabledPolestars] = useStateWithStorage('crewretrieval/disabledPolestars', []);
	const [ownedFilter, setOwnedFilter] = useStateWithStorage('crewretrieval/ownedFilter', ownedFilterOptions[0].value);
	const [minRarity, setMinRarity] = useStateWithStorage('crewretrieval/minRarity', null);
	const [collection, setCollection] = useStateWithStorage('crewretrieval/collection', null);

	const [data, setData] = React.useState(null);

	// Update dataset on any filter change
	React.useEffect(() => {
		let filteredPolestars = ownedPolestars.filter((p) => disabledPolestars.indexOf(p.id) === -1);
		let retrievable = allCrew.filter(
			(crew) => crew.unique_polestar_combos?.some(
				(upc) => upc.every(
					(trait) => filteredPolestars.some(op => filterTraits(op, trait))
				)
			)
		);

		let excludeFF = ownedFilterOptions[2].value === ownedFilter ? true : false;
		retrievable.sort((a, b) => b.rarity - a.rarity);
		retrievable.forEach(crew => { crew.highest_owned_rarity = findHighestOwnedRarityForCrew(retrievable, crew.symbol, excludeFF) });
		retrievable = retrievable.filter(ownedFilters[ownedFilter](playerData.player.character.crew));

		if (minRarity) {
			retrievable = retrievable.filter((crew) => crew.max_rarity >= minRarity);
		}

		if (collection) {
			retrievable = retrievable.filter((crew) => crew.collections.indexOf(collection) !== -1);
		}

		setData([...retrievable]);
	}, [disabledPolestars, ownedFilter, minRarity, collection]);

	const energy = playerData.crew_crafting_root.energy;
	let energyMessage = "You can guarantee a legendary crew retrieval now!";
	if (energy.quantity < 900) {
		let seconds = ((900-energy.quantity)*energy.regeneration.seconds)+energy.regenerated_at;
		let d = Math.floor(seconds/(3600*24)),
			h = Math.floor(seconds%(3600*24)/3600),
			m = Math.floor(seconds%3600/60);
		energyMessage = "You will regenerate enough quantum to guarantee a legendary crew retrieval in "+d+"d, "+h+"h, "+m+"m.";
	}

	return (
		<>
			<p>Quantum: <strong>{energy.quantity}</strong>. {energyMessage}</p>
			<p>Here are all the crew who you can perform a 100% guaranteed crew retrieval for, using the polestars currently in your inventory:</p>
			<Form>
				<Form.Group inline>
					<PolestarsModal ownedPolestars={ownedPolestars} disabledPolestars={disabledPolestars} updateDisableds={updateDisableds} />
					<Form.Field
						control={Dropdown}
						selection
						options={ownedFilterOptions}
						value={ownedFilter}
						onChange={(e, { value }) => setOwnedFilter(value)}
					/>
					<Form.Field
						control={Dropdown}
						placeholder="Minimum rarity"
						selection
						options={rarityOptions}
						value={minRarity}
						onChange={(e, { value }) => setMinRarity(value)}
					/>
					<Form.Field
						control={Dropdown}
						placeholder="Collections"
						selection
						options={collectionsOptions}
						value={collection}
						onChange={(e, { value }) => setCollection(value)}
					/>
				</Form.Group>
			</Form>
			<CrewTable ownedPolestars={ownedPolestars} disabledPolestars={disabledPolestars} data={data} />
		</>
	);

	function findHighestOwnedRarityForCrew(crew: any[], crewSymbol: string, excludeFF: boolean): number {
		const highestRarityMatchingCrew = (excludeFF && excludeFF === true)
			? crew.find((c) => c.symbol === crewSymbol && c.rarity < c.max_rarity)
			: crew.find((c) => c.symbol === crewSymbol);
		if (highestRarityMatchingCrew) {
			return highestRarityMatchingCrew['rarity'];
		}
		return 0;
	}

	function updateDisableds(newDisableds: number[]): void {
		setDisabledPolestars([...newDisableds]);
	}
};

type PolestarsModalProps = {
	ownedPolestars: any;
	disabledPolestars: number[];
	updateDisableds: (disabledPolestars: number[]) => void;
};

const PolestarsModal = (props: PolestarsModalProps) => {
	const { ownedPolestars, updateDisableds } = props;

	const [modalFilterIsOpen, setModalFilterIsOpen] = React.useState(false);
	const [disabledPolestars, setDisabledPolestars] = React.useState(props.disabledPolestars);

	// Recalculate combos only when modal gets closed
	React.useEffect(() => {
		if (!modalFilterIsOpen && JSON.stringify(disabledPolestars) != JSON.stringify(props.disabledPolestars)) {
			updateDisableds([...disabledPolestars]);
		}
	}, [modalFilterIsOpen]);

	const rarityIds = [14502, 14504, 14506, 14507, 14509];
	const skillIds = [14511, 14512, 14513, 14514, 14515, 14516];
	const grouped = [
		{
			title: "Rarity",
			polestars: [],
			anyDisabled: false
		},
		{
			title: "Skills",
			polestars: [],
			anyDisabled: false
		},
		{
			title: "Traits",
			polestars: [],
			anyDisabled: false
		},
	];
	ownedPolestars.forEach(p => {
		let group = 2;
		if (rarityIds.indexOf(p.id) !== -1) group = 0;
		if (skillIds.indexOf(p.id) !== -1) group = 1;
		grouped[group].polestars.push(p);
		if (disabledPolestars.indexOf(p.id) !== -1) grouped[group].anyDisabled = true;
	});

	return (
		<Modal
			open={modalFilterIsOpen}
			onClose={() => setModalFilterIsOpen(false)}
			onOpen={() => setModalFilterIsOpen(true)}
			trigger={<Button><Icon name='filter' />{ownedPolestars.length-disabledPolestars.length} / {ownedPolestars.length} Polestars</Button>}
			size='large'
		>
			<Modal.Header>Filter Owned Polestars</Modal.Header>
			<Modal.Content scrolling>
				<Grid columns={4} stackable padded>
					{createFilterCheckboxes()}
				</Grid>
			</Modal.Content>
			<Modal.Actions>
				<Button positive onClick={() => setModalFilterIsOpen(false)}>
					Update Filter
				</Button>
			</Modal.Actions>
		</Modal>
	);

	function filterCheckbox(p: any): JSX.Element {
		return (
			<Grid.Column key={p.id}>
				<Checkbox
					toggle
					id={`polestar_filter_id_${p.id}`}
					label={`${p.short_name} (${p.quantity})`}
					checked={disabledPolestars.indexOf(p.id)===-1}
					onChange={(e) => checkOne(p.id, e.target.checked)}
				/>
			</Grid.Column>
		)
	}

	function filterCheckboxGroupHeader(t: string): JSX.Element {
		let group = grouped.find(group => group.title === t);
		let groupLink = group ? (<Button style={{ marginLeft: '1em' }} size='mini' onClick={() => checkGroup(t, group.anyDisabled)}>{group.anyDisabled ? 'Check' : 'Uncheck'} All</Button>): (<></>);
		return (
			<Grid.Column largeScreen={16} mobile={4} key={t}>
				<strong>{t}</strong> {groupLink}
			</Grid.Column>
		)
	}

	function createFilterCheckboxes(): JSX.Element[] {
		const checkboxes = [];
		grouped.map((group) => {
			if(group.polestars.length > 0) {
				checkboxes.push(filterCheckboxGroupHeader(group.title));
				group.polestars.map((polestar) => {
					checkboxes.push(filterCheckbox(polestar));
				});
			}
		});
		return checkboxes;
	}

	function checkOne(id: number, checked: boolean): void {
		handleFilterChange(id, checked);
		setDisabledPolestars([...disabledPolestars]);
	}

	function checkGroup(t: string, checkAll: boolean): void {
		let group = grouped.find(group => group.title === t);
		group.polestars.forEach(p => handleFilterChange(p.id, checkAll));
		setDisabledPolestars([...disabledPolestars]);
	}

	function handleFilterChange(id: number, checked: boolean): void {
		if(checked === true && disabledPolestars.indexOf(id) !== -1) {
			disabledPolestars.splice(disabledPolestars.indexOf(id), 1);
		}
		if(checked === false && disabledPolestars.indexOf(id) === -1) {
			disabledPolestars.push(id);
		}
	}
};

type CrewTableProps = {
	data: any[];
	ownedPolestars: any;
	disabledPolestars: number[];
};

const CrewTable = (props: CrewTableProps) => {
	const { data, ownedPolestars, disabledPolestars } = props;

	const [activeCrew, setActiveCrew] = React.useState(null);
	const [activeCollections, setActiveCollections] = React.useState(null);

	if (!data) return (<></>);

	return (
		<SearchableTable
			id={"crewretrieval"}
			data={data}
			config={tableConfig}
			renderTableRow={(crew, idx) => renderTableRow(crew, idx)}
			filterRow={(crew, filters, filterType) => crewMatchesSearchFilter(crew, filters, filterType)}
			showFilterOptions={true}
		/>
	);

	function renderTableRow(crew: any, idx: number): JSX.Element {
		return (
			<Table.Row key={idx}>
				<Table.Cell style={{ cursor: 'zoom-in' }} onClick={() => navigate(`/crew/${crew.symbol}/`)}>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: '60px auto',
							gridTemplateAreas: `'icon stats' 'icon description'`,
							gridGap: '1px'
						}}
					>
						<div style={{ gridArea: 'icon' }}>
							<img width={48} src={`${process.env.GATSBY_ASSETS_URL}${crew.imageUrlPortrait}`} />
						</div>
						<div style={{ gridArea: 'stats' }}>
							<span style={{ fontWeight: 'bolder', fontSize: '1.25em' }}>{crew.name}</span>
						</div>
						<div style={{ gridArea: 'description' }}>{getCoolStats(crew, false, false)}</div>
					</div>
				</Table.Cell>
				<Table.Cell>
					<Rating icon='star' rating={crew.highest_owned_rarity} maxRating={crew.max_rarity} size="large" disabled />
				</Table.Cell>
				<Table.Cell textAlign="center" style={{ display: activeCrew === crew.symbol ? 'none' : 'table-cell' }}>
					<b>{formatTierLabel(crew.bigbook_tier)}</b>
				</Table.Cell>
				<Table.Cell textAlign="center" style={{ display: activeCrew === crew.symbol ? 'none' : 'table-cell' }}>
					<b>{crew.cab_ov}</b><br />
					<small>{rarityLabels[parseInt(crew.max_rarity)-1]} #{crew.cab_ov_rank}</small>
				</Table.Cell>
				<Table.Cell textAlign="center" style={{ display: activeCrew === crew.symbol ? 'none' : 'table-cell' }}>
					<b>#{crew.ranks.voyRank}</b><br />
					{crew.ranks.voyTriplet && <small>Triplet #{crew.ranks.voyTriplet.rank}</small>}
				</Table.Cell>
				<Table.Cell textAlign="center"
					style={{ cursor: activeCollections === crew.symbol ? 'zoom-out' : 'zoom-in', display: activeCrew === crew.symbol ? 'none' : 'table-cell' }}
					onClick={() => { setActiveCollections(activeCollections === crew.symbol ? null : crew.symbol) }}
				>
					{showCollectionsForCrew(crew)}
				</Table.Cell>
				<Table.Cell textAlign="center" style={{ display: activeCrew === crew.symbol ? 'table-cell' : 'none' }}
					colSpan={activeCrew === crew.symbol ? 4 : undefined}
				>
					{showCombosForCrew(crew)}
				</Table.Cell>
				<Table.Cell textAlign="center" style={{ cursor: activeCrew === crew.symbol ? 'zoom-out' : 'zoom-in' }}
					onClick={(e) => { setActiveCrew(activeCrew === crew.symbol ? null : crew.symbol); e.stopPropagation(); }}
				>
					{activeCrew === crew.symbol ? 'Hide' : 'View'}
				</Table.Cell>
			</Table.Row>
		);
	}

	function showCombosForCrew(crew: any): JSX.Element {
		if (activeCrew !== crew.symbol) return (<></>);

		let filteredPolestars = ownedPolestars.filter((p) => disabledPolestars.indexOf(p.id) === -1);
		let combos = crew.unique_polestar_combos?.filter(
			(upc) => upc.every(
				(trait) => filteredPolestars.some(op => filterTraits(op, trait))
			)
		).map((upc) => upc.map((trait) => ownedPolestars.find((op) => filterTraits(op, trait))));

		// Exit here if activecrew has 0 combos after changing filters
		if (combos.length == 0) return (<></>);

		let fuseGroups = groupByFuses(combos, 0, []);

		return (<ComboGrid crew={crew} combos={combos} fuseGroups={fuseGroups} />);
	}

	function groupByFuses(combos: any[], start: number, group: number[]): any {
		const fuseGroups = {};
		const consumed = {};
		group.forEach((comboId) => {
			combos[comboId].forEach((polestar) => {
				if (consumed[polestar.symbol])
					consumed[polestar.symbol]++;
				else
					consumed[polestar.symbol] = 1;
			});
		});
		combos.forEach((combo, comboId) => {
			if (comboId >= start) {
				let consumable = 0;
				combo.forEach((polestar) => {
					if (!consumed[polestar.symbol] || polestar.quantity-consumed[polestar.symbol] >= 1)
						consumable++;
				});
				if (consumable == combo.length) {
					const parentGroup = [...group, comboId];
					const parentId = 'x'+parentGroup.length;
					if (fuseGroups[parentId])
						fuseGroups[parentId].push(parentGroup);
					else
						fuseGroups[parentId] = [parentGroup];
					let childGroups = groupByFuses(combos, comboId, parentGroup);
					for (let childId in childGroups) {
						if (fuseGroups[childId])
							fuseGroups[childId] = fuseGroups[childId].concat(childGroups[childId]);
						else
							fuseGroups[childId] = childGroups[childId];
					}
				}
			}
		});
		return fuseGroups;
	}

	function showCollectionsForCrew(crew: any): JSX.Element {
		if (activeCollections !== crew.symbol || crew.collections.length == 0)
			return (<b>{crew.collections.length}</b>);

		const formattedCollections = crew.collections.map((c, idx) => (
			<span key={idx}>{c}{idx < crew.collections.length-1 ? ',' : ''}</span>
		)).reduce((prev, curr) => [prev, ' ', curr]);

		return (
			<div>
				{formattedCollections}
			</div>
		);
	}
};

type ComboGridProps = {
	crew: any;
	combos: any[];
	fuseGroups: any;
};

const ComboGrid = ((props: ComboGridProps) => {
	const { crew, fuseGroups } = props;
	let combos = [...props.combos];

	let [fuseIndex, setFuseIndex] = React.useState(1);
	let [groupIndex, setGroupIndex] = React.useState(0);

	React.useEffect(() => {
		setGroupIndex(0);
	}, [fuseIndex]);

	// Reset indices if out of bounds after changing filters
	if (!fuseGroups['x'+fuseIndex]) fuseIndex = 1;
	const groups = fuseGroups['x'+fuseIndex];
	if (!groups[groupIndex]) groupIndex = 0;

	const fuseOptions = [];
	[1, 2, 3, 4, 5].forEach(fuse => {
		const fuseId = 'x'+fuse;
		if (fuseGroups[fuseId] && fuseGroups[fuseId].length > 0) {
			fuseOptions.push({ key: fuse, value: fuse, text: fuseId });
		}
	});

	let groupOptions = [];
	if (fuseIndex > 1) {
		combos = groups[groupIndex].map((comboId) => combos[comboId]);
		groupOptions = groups.map((group, groupId) => {
			return { key: groupId, value: groupId, text: 'Option '+(groupId+1) };
		});
	}

	return (
		<div>
			<div className='title' style={{ marginBottom: '1em' }}>
				Use <b>{fuseIndex == 1 ? combos.length == 1 ? 'the combo' : 'any combo' : 'all combos'}</b> below to retrieve <b>{crew.name}</b>
				{fuseOptions.length > 1 && (
					<Dropdown
						style={{ marginLeft: '1em' }}
						options={fuseOptions}
						value={fuseIndex}
						onChange={(e, { value }) => setFuseIndex(value)}
					/>
				)}
				{groupOptions.length > 1 && (
					<Dropdown scrolling
						style={{ marginLeft: '1em' }}
						options={groupOptions}
						value={groupIndex}
						onChange={(e, { value }) => setGroupIndex(value)}
					/>
				)}
			</div>
			<div className='content'>
				<Grid columns='equal' onClick={() => cycleGroupOptions()}>
					{combos.map((combo, cdx) =>
						<Grid.Row key={'combo'+cdx}>
							{combo.map((polestar, pdx) => (
								<Grid.Column key={'combo'+cdx+',polestar'+pdx}>
									<img width={32} src={`${process.env.GATSBY_ASSETS_URL}${polestar.icon.file.substr(1).replace(/\//g, '_')}`} />
									<br />{polestar.name.replace(' Polestar', '').replace(' Skill', '')}
									<br /><small>({polestar.quantity})</small>
								</Grid.Column>
							))}
						</Grid.Row>
					)}
				</Grid>
			</div>
		</div>
	);

	function cycleGroupOptions(): void {
		if (groups.length <= 1) return;
		setGroupIndex(groupIndex+1 < groups.length ? groupIndex+1 : 0);
	}
});

export default CrewRetrieval;
